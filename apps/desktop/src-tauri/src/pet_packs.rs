use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;
use zip::ZipArchive;

use super::read_pet_pack_root;

const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 65_536;
const PETDEX_FRAME_WIDTH: u32 = 192;
const PETDEX_FRAME_HEIGHT: u32 = 208;
const PETDEX_ATLAS_WIDTH: u32 = 1536;
const PETDEX_V1_HEIGHT: u32 = 1872;
const PETDEX_V2_HEIGHT: u32 = 2288;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PetPackSource {
    Openclaw,
    Petdex,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackSummary {
    pub key: String,
    pub id: String,
    pub name: String,
    pub license: String,
    pub active: bool,
    pub source: PetPackSource,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PetdexManifest {
    id: String,
    display_name: String,
    #[allow(dead_code)]
    description: Option<String>,
    spritesheet_path: String,
    sprite_version_number: Option<u8>,
    #[allow(dead_code)]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct InstalledManifest {
    id: String,
    name: String,
    license: String,
}

#[derive(Deserialize, Serialize)]
struct InstallMetadata {
    source: PetPackSource,
}

#[derive(Deserialize, Serialize)]
struct ActiveSelection {
    key: String,
}

fn packs_root(app_data: &Path) -> PathBuf {
    app_data.join("pet-packs")
}

fn installed_directory(app_data: &Path) -> PathBuf {
    packs_root(app_data).join("installed")
}

fn safe_relative_path(path: &Path) -> Result<String, String> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Pet import contains an unsafe path".into());
    }
    let normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.is_empty()
        || normalized.len() > 512
        || normalized.split('/').count() > 6
        || normalized.chars().any(char::is_control)
    {
        return Err("Pet import contains an unsafe path".into());
    }
    Ok(normalized)
}

fn insert_source_file(
    files: &mut HashMap<String, Vec<u8>>,
    name: String,
    bytes: Vec<u8>,
    total: &mut u64,
) -> Result<(), String> {
    if files.len() >= MAX_FILES || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Pet import exceeds the file limits".into());
    }
    *total = total.saturating_add(bytes.len() as u64);
    if *total > MAX_TOTAL_BYTES {
        return Err("Pet import exceeds the total size limit".into());
    }
    if files.insert(name, bytes).is_some() {
        return Err("Pet import contains duplicate paths".into());
    }
    Ok(())
}

fn open_directory_nofollow(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| "Pet import source is not a safe directory".to_string())
}

fn open_regular_file_nofollow(path: &Path, max_bytes: u64) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| "Pet import source is not a safe regular file".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "Pet import source metadata is unavailable".to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("Pet import source is not a safe regular file".into());
    }
    Ok(file)
}

fn openat_nofollow(parent: &File, name: &std::ffi::OsStr, directory: bool) -> Result<File, String> {
    let name = CString::new(name.as_bytes())
        .map_err(|_| "Pet import contains an unsafe path".to_string())?;
    let flags = libc::O_RDONLY
        | libc::O_NOFOLLOW
        | libc::O_CLOEXEC
        | if directory { libc::O_DIRECTORY } else { 0 };
    // SAFETY: `parent` owns a live directory descriptor and `name` is a
    // NUL-free single path component. The returned descriptor is checked
    // before ownership is transferred to `File`.
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if descriptor < 0 {
        return Err("Pet import may not contain links or special files".into());
    }
    // SAFETY: `openat` returned a new owned descriptor and no other `File`
    // owns it. `File` closes it exactly once.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

fn read_relative_nofollow(root: &File, path: &Path) -> Result<Vec<u8>, String> {
    let components = path
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value),
            _ => Err("Pet import contains an unsafe path".to_string()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (file_name, directories) = components
        .split_last()
        .ok_or_else(|| "Pet import contains an unsafe path".to_string())?;
    let mut parent = root
        .try_clone()
        .map_err(|_| "Pet import source could not be read".to_string())?;
    for directory in directories {
        parent = openat_nofollow(&parent, directory, true)?;
    }
    let mut file = openat_nofollow(&parent, file_name, false)?;
    let metadata = file
        .metadata()
        .map_err(|_| "Pet import file metadata is unavailable".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("Pet import may not contain links or special files".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Pet import file could not be read".to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Pet import exceeds the file limits".into());
    }
    Ok(bytes)
}

fn read_directory_source(root: &Path) -> Result<HashMap<String, Vec<u8>>, String> {
    let root_handle = open_directory_nofollow(root)?;
    let mut files = HashMap::new();
    let mut total = 0_u64;
    for entry in WalkDir::new(root).follow_links(false) {
        let entry =
            entry.map_err(|_| "Pet import directory could not be enumerated".to_string())?;
        if entry.depth() > 6 {
            return Err("Pet import is nested too deeply".into());
        }
        if entry.depth() == 0 || entry.file_type().is_dir() {
            continue;
        }
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            return Err("Pet import may not contain links or special files".into());
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| "Pet import path is invalid".to_string())?;
        let name = safe_relative_path(relative)?;
        let bytes = read_relative_nofollow(&root_handle, relative)?;
        insert_source_file(&mut files, name, bytes, &mut total)?;
    }
    Ok(files)
}

fn read_zip_source(path: &Path) -> Result<HashMap<String, Vec<u8>>, String> {
    let file = open_regular_file_nofollow(path, MAX_TOTAL_BYTES)
        .map_err(|_| "Pet import ZIP is not a safe regular file".to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "Pet import ZIP is invalid".to_string())?;
    if archive.len() > MAX_FILES {
        return Err("Pet import exceeds the file limits".into());
    }
    let mut files = HashMap::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "Pet import ZIP is invalid".to_string())?;
        if entry.is_dir() {
            continue;
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "Pet import ZIP contains an unsafe path".to_string())?;
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 {
                return Err("Pet import ZIP may not contain links or special files".into());
            }
        }
        if entry.size() > MAX_FILE_BYTES {
            return Err("Pet import exceeds the file limits".into());
        }
        let name = safe_relative_path(&enclosed)?;
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Pet import ZIP entry could not be read".to_string())?;
        insert_source_file(&mut files, name, bytes, &mut total)?;
    }
    Ok(files)
}

fn normalized_files(files: HashMap<String, Vec<u8>>) -> Result<HashMap<String, Vec<u8>>, String> {
    let manifests = files
        .keys()
        .filter(|name| {
            name.as_str() == "pet.json"
                || name.as_str() == "manifest.json"
                || name.ends_with("/pet.json")
                || name.ends_with("/manifest.json")
        })
        .cloned()
        .collect::<Vec<_>>();
    if manifests.len() != 1 {
        return Err("Pet import must contain exactly one pet.json or manifest.json".into());
    }
    let manifest = &manifests[0];
    let prefix = manifest
        .rsplit_once('/')
        .map(|(prefix, _)| format!("{prefix}/"))
        .unwrap_or_default();
    let mut normalized = HashMap::new();
    for (name, bytes) in files {
        if !prefix.is_empty() && !name.starts_with(&prefix) {
            return Err("Pet import contains files outside its package root".into());
        }
        let stripped = name.strip_prefix(&prefix).unwrap_or(&name).to_string();
        if stripped.is_empty() || normalized.insert(stripped, bytes).is_some() {
            return Err("Pet import contains duplicate paths".into());
        }
    }
    Ok(normalized)
}

fn validate_raster(bytes: &[u8], extension: &str) -> Result<(u32, u32, &'static str), String> {
    let expected = match extension {
        "png" => (ImageFormat::Png, "image/png"),
        "webp" => (ImageFormat::WebP, "image/webp"),
        _ => return Err("Pet import spritesheet must be PNG or WebP".into()),
    };
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "Pet import spritesheet is invalid".to_string())?;
    if reader.format() != Some(expected.0) {
        return Err("Pet import spritesheet type does not match its extension".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| "Pet import spritesheet is invalid".to_string())?;
    Ok((image.width(), image.height(), expected.1))
}

fn slug(value: &str) -> String {
    let mut output = String::new();
    let mut separator = false;
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            separator = false;
        } else if !separator && !output.is_empty() {
            output.push('-');
            separator = true;
        }
        if output.len() >= 80 {
            break;
        }
    }
    while output.ends_with('-') {
        output.pop();
    }
    if output.is_empty() {
        "imported-pet".into()
    } else {
        output
    }
}

fn state(row: usize, frames: usize) -> serde_json::Value {
    json!({
        "asset": "main",
        "frames": (0..frames).map(|frame| row * 8 + frame).collect::<Vec<_>>(),
        "fps": 8,
        "loop": true
    })
}

fn convert_petdex(files: &HashMap<String, Vec<u8>>) -> Result<(String, Vec<u8>), String> {
    let manifest_bytes = files
        .get("pet.json")
        .ok_or_else(|| "Petdex import is missing pet.json".to_string())?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Petdex pet.json exceeds the size limit".into());
    }
    let petdex: PetdexManifest = serde_json::from_slice(manifest_bytes)
        .map_err(|_| "Petdex pet.json is invalid".to_string())?;
    if petdex.id.trim().is_empty() || petdex.display_name.trim().is_empty() {
        return Err("Petdex pet.json is missing its id or display name".into());
    }
    let sprite_path = Path::new(&petdex.spritesheet_path);
    let sprite_name = safe_relative_path(sprite_path)?;
    if sprite_name.contains('/') {
        return Err("Petdex spritesheetPath must name a package-root file".into());
    }
    let sprite = files
        .get(&sprite_name)
        .ok_or_else(|| "Petdex spritesheet is missing".to_string())?
        .clone();
    if files.keys().any(|name| {
        name != "pet.json"
            && name != &sprite_name
            && name != "LICENSE.txt"
            && name != "ATTRIBUTION.txt"
    }) {
        return Err("Petdex import contains an unsupported file".into());
    }
    let extension = sprite_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Petdex spritesheet has no supported extension".to_string())?;
    let (width, height, mime_type) = validate_raster(&sprite, &extension)?;
    let version = petdex.sprite_version_number.unwrap_or(1);
    let expected_height = match version {
        1 => PETDEX_V1_HEIGHT,
        2 => PETDEX_V2_HEIGHT,
        _ => return Err("Petdex spriteVersionNumber must be 2 when provided".into()),
    };
    if width != PETDEX_ATLAS_WIDTH || height != expected_height {
        return Err(format!(
            "Petdex spritesheet must be {PETDEX_ATLAS_WIDTH}x{expected_height} for v{version}",
        ));
    }
    let sha = format!("{:x}", Sha256::digest(&sprite));
    let manifest = json!({
        "formatVersion": 1,
        "id": format!("local.petdex.{}", slug(&petdex.id)),
        "version": "1.0.0",
        "name": petdex.display_name.trim().chars().take(128).collect::<String>(),
        "license": "NOASSERTION",
        "engine": { "min": "0.4.0" },
        "assets": {
            "main": {
                "path": format!("assets/spritesheet.{extension}"),
                "mimeType": mime_type,
                "sha256": sha,
                "width": width,
                "height": height,
                "frameWidth": PETDEX_FRAME_WIDTH,
                "frameHeight": PETDEX_FRAME_HEIGHT
            }
        },
        "states": {
            "idle": state(6, 6),
            "listening": state(7, 6),
            "transcribing": state(1, 8),
            "thinking": state(1, 8),
            "working": state(3, 4),
            "needs_input": state(4, 5),
            "speaking": state(8, 6),
            "succeeded": state(0, 6),
            "failed": state(5, 8),
            "offline": state(6, 6)
        }
    });
    let manifest = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "Petdex manifest conversion failed".to_string())?;
    Ok((manifest, sprite))
}

fn stage_package(
    app_data: &Path,
    files: HashMap<String, Vec<u8>>,
) -> Result<(PathBuf, PetPackSource), String> {
    let packs = packs_root(app_data);
    fs::create_dir_all(&packs).map_err(|_| "Pet Pack storage is unavailable".to_string())?;
    let staging = packs.join(format!(".staging-{:016x}", rand::random::<u64>()));
    fs::create_dir(&staging)
        .map_err(|_| "Pet Pack staging directory could not be created".to_string())?;
    let result = (|| {
        let source;
        if files.contains_key("pet.json") {
            source = PetPackSource::Petdex;
            let (manifest, sprite) = convert_petdex(&files)?;
            let parsed: serde_json::Value = serde_json::from_str(&manifest)
                .map_err(|_| "Converted Pet Pack manifest is invalid".to_string())?;
            let asset_path = parsed["assets"]["main"]["path"]
                .as_str()
                .ok_or_else(|| "Converted Pet Pack asset path is invalid".to_string())?;
            fs::create_dir_all(staging.join("assets"))
                .map_err(|_| "Pet Pack assets could not be staged".to_string())?;
            fs::write(staging.join("manifest.json"), manifest)
                .map_err(|_| "Pet Pack manifest could not be staged".to_string())?;
            fs::write(staging.join(asset_path), sprite)
                .map_err(|_| "Pet Pack spritesheet could not be staged".to_string())?;
            fs::create_dir_all(staging.join("attribution"))
                .map_err(|_| "Pet Pack attribution could not be staged".to_string())?;
            fs::write(
                staging.join("attribution/petdex.json"),
                files
                    .get("pet.json")
                    .ok_or_else(|| "Petdex attribution is missing".to_string())?,
            )
            .map_err(|_| "Pet Pack attribution could not be staged".to_string())?;
            if let Some(license) = files.get("LICENSE.txt") {
                fs::write(staging.join("LICENSE.txt"), license)
                    .map_err(|_| "Pet Pack license could not be staged".to_string())?;
            }
            if let Some(attribution) = files.get("ATTRIBUTION.txt") {
                fs::write(staging.join("ATTRIBUTION.txt"), attribution)
                    .map_err(|_| "Pet Pack attribution could not be staged".to_string())?;
            }
        } else {
            source = PetPackSource::Openclaw;
            let manifest = files
                .get("manifest.json")
                .ok_or_else(|| "Pet Pack import is missing manifest.json".to_string())?;
            if manifest.len() > MAX_MANIFEST_BYTES {
                return Err("Pet Pack manifest exceeds the size limit".into());
            }
            fs::write(staging.join("manifest.json"), manifest)
                .map_err(|_| "Pet Pack manifest could not be staged".to_string())?;
            for (name, bytes) in &files {
                if name == "manifest.json" {
                    continue;
                }
                if name == "LICENSE.txt" || name == "ATTRIBUTION.txt" {
                    fs::write(staging.join(name), bytes)
                        .map_err(|_| "Pet Pack attribution could not be staged".to_string())?;
                    continue;
                }
                if !name.starts_with("assets/") {
                    return Err("Pet Pack contains an unsupported file".into());
                }
                let target = staging.join(name);
                fs::create_dir_all(
                    target
                        .parent()
                        .ok_or_else(|| "Pet Pack path is invalid".to_string())?,
                )
                .map_err(|_| "Pet Pack asset directory could not be staged".to_string())?;
                fs::write(target, bytes)
                    .map_err(|_| "Pet Pack asset could not be staged".to_string())?;
            }
        }
        fs::write(
            staging.join("install.json"),
            serde_json::to_vec(&InstallMetadata { source })
                .map_err(|_| "Pet Pack install metadata is invalid".to_string())?,
        )
        .map_err(|_| "Pet Pack install metadata could not be staged".to_string())?;
        read_pet_pack_root(&staging)?;
        Ok(source)
    })();
    match result {
        Ok(source) => Ok((staging, source)),
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}

fn summary(root: &Path, key: String, active_key: Option<&str>) -> Result<PetPackSummary, String> {
    read_pet_pack_root(root)?;
    let manifest: InstalledManifest = serde_json::from_slice(
        &fs::read(root.join("manifest.json"))
            .map_err(|_| "Pet Pack manifest could not be read".to_string())?,
    )
    .map_err(|_| "Pet Pack manifest is invalid".to_string())?;
    let source = fs::read(root.join("install.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<InstallMetadata>(&bytes).ok())
        .map(|metadata| metadata.source)
        .unwrap_or(PetPackSource::Openclaw);
    Ok(PetPackSummary {
        active: active_key == Some(key.as_str()),
        key,
        id: manifest.id,
        name: manifest.name,
        license: manifest.license,
        source,
    })
}

fn active_key(app_data: &Path) -> Result<Option<String>, String> {
    let path = packs_root(app_data).join("active.json");
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<ActiveSelection>(&bytes)
            .map(|selection| Some(selection.key))
            .map_err(|_| "Active Pet Pack selection is invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Active Pet Pack selection is unavailable".into()),
    }
}

pub fn import_source(app_data: &Path, source: &Path) -> Result<PetPackSummary, String> {
    let metadata =
        fs::symlink_metadata(source).map_err(|_| "Pet import source is unavailable".to_string())?;
    let files = if metadata.is_dir() && !metadata.file_type().is_symlink() {
        read_directory_source(source)?
    } else if metadata.is_file()
        && !metadata.file_type().is_symlink()
        && source
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
    {
        read_zip_source(source)?
    } else {
        return Err("Pet import source must be a safe directory or ZIP file".into());
    };
    let files = normalized_files(files)?;
    let (staging, _source_kind) = stage_package(app_data, files)?;
    let manifest_bytes = fs::read(staging.join("manifest.json"))
        .map_err(|_| "Pet Pack manifest could not be read".to_string())?;
    let installed_manifest: InstalledManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "Pet Pack manifest is invalid".to_string())?;
    let mut digest = Sha256::new();
    for entry in WalkDir::new(&staging).sort_by_file_name() {
        let entry = entry.map_err(|_| "Pet Pack files could not be hashed".to_string())?;
        if entry.file_type().is_file() {
            let relative = entry
                .path()
                .strip_prefix(&staging)
                .map_err(|_| "Pet Pack file path is invalid".to_string())?;
            digest.update(relative.as_os_str().as_bytes());
            digest.update(
                fs::read(entry.path())
                    .map_err(|_| "Pet Pack file could not be hashed".to_string())?,
            );
        }
    }
    let hash = format!("{:x}", digest.finalize());
    let id = slug(&installed_manifest.id);
    let key = format!("{}-{}", id, &hash[..12]);
    let installed = installed_directory(app_data);
    fs::create_dir_all(&installed).map_err(|_| "Pet Pack storage is unavailable".to_string())?;
    let destination = installed.join(&key);
    if destination.exists() {
        let _ = fs::remove_dir_all(&staging);
    } else {
        fs::rename(&staging, &destination)
            .map_err(|_| "Pet Pack could not be installed atomically".to_string())?;
    }
    summary(&destination, key, active_key(app_data)?.as_deref())
}

pub fn list_installed(app_data: &Path) -> Result<Vec<PetPackSummary>, String> {
    let installed = installed_directory(app_data);
    let active = active_key(app_data)?;
    let entries = match fs::read_dir(&installed) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("Pet Pack storage is unavailable".into()),
    };
    let mut packs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| "Pet Pack storage could not be enumerated".to_string())?;
        let metadata = entry
            .metadata()
            .map_err(|_| "Pet Pack metadata is unavailable".to_string())?;
        if !metadata.is_dir()
            || entry
                .file_type()
                .map_err(|_| "Pet Pack metadata is unavailable".to_string())?
                .is_symlink()
        {
            continue;
        }
        let key = entry.file_name().to_string_lossy().into_owned();
        packs.push(summary(&entry.path(), key, active.as_deref())?);
    }
    packs.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(packs)
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 160
        || !key.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '.'
        })
    {
        return Err("Pet Pack key is invalid".into());
    }
    Ok(())
}

pub fn installed_root(app_data: &Path, key: &str) -> Result<PathBuf, String> {
    validate_key(key)?;
    let root = installed_directory(app_data).join(key);
    read_pet_pack_root(&root)?;
    Ok(root)
}

pub fn activate(app_data: &Path, key: &str) -> Result<(), String> {
    installed_root(app_data, key)?;
    let packs = packs_root(app_data);
    fs::create_dir_all(&packs).map_err(|_| "Pet Pack storage is unavailable".to_string())?;
    let temporary = packs.join(format!(".active-{:016x}.json", rand::random::<u64>()));
    fs::write(
        &temporary,
        serde_json::to_vec(&ActiveSelection { key: key.into() })
            .map_err(|_| "Active Pet Pack selection is invalid".to_string())?,
    )
    .map_err(|_| "Active Pet Pack selection could not be written".to_string())?;
    fs::rename(&temporary, packs.join("active.json"))
        .map_err(|_| "Active Pet Pack selection could not be committed".to_string())
}

pub fn remove(app_data: &Path, key: &str) -> Result<bool, String> {
    validate_key(key)?;
    if active_key(app_data)?.as_deref() == Some(key) {
        return Err("The active Pet Pack cannot be removed".into());
    }
    let root = installed_directory(app_data).join(key);
    match fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(root).map_err(|_| "Pet Pack could not be removed".to_string())?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        _ => Err("Pet Pack is not a safe managed directory".into()),
    }
}

pub fn active_managed_root(app_data: &Path) -> Result<Option<PathBuf>, String> {
    match active_key(app_data)? {
        Some(key) => installed_root(app_data, &key).map(Some),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::fs;
    use std::io::Cursor;
    use std::io::Write;
    use std::os::unix::fs::symlink;
    use zip::write::SimpleFileOptions;

    fn write_petdex_source(root: &Path) {
        fs::create_dir_all(root).expect("source directory");
        fs::write(
            root.join("pet.json"),
            r#"{"id":"sample-fox","displayName":"Sample Fox","description":"fixture","spritesheetPath":"spritesheet.webp","kind":"animal"}"#,
        )
        .expect("manifest");
        let image =
            DynamicImage::ImageRgba8(ImageBuffer::from_pixel(1536, 1872, Rgba([0_u8, 0, 0, 0])));
        let mut bytes = Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, ImageFormat::WebP)
            .expect("webp fixture");
        fs::write(root.join("spritesheet.webp"), bytes.into_inner()).expect("spritesheet");
        fs::write(root.join("LICENSE.txt"), "Sample attribution only").expect("license");
    }

    #[test]
    fn imports_a_real_shape_petdex_directory_without_activating_it() {
        let app_data = tempfile::tempdir().expect("app data");
        let source = tempfile::tempdir().expect("source");
        write_petdex_source(source.path());

        let imported = import_source(app_data.path(), source.path()).expect("import");
        assert_eq!(imported.id, "local.petdex.sample-fox");
        assert_eq!(imported.license, "NOASSERTION");
        assert_eq!(imported.source, PetPackSource::Petdex);
        assert!(!imported.active);
        assert!(active_managed_root(app_data.path())
            .expect("active root")
            .is_none());
        assert_eq!(list_installed(app_data.path()).expect("installed").len(), 1);
        let installed = installed_root(app_data.path(), &imported.key).expect("installed root");
        assert!(installed.join("LICENSE.txt").is_file());
        assert!(installed.join("attribution/petdex.json").is_file());
    }

    #[test]
    fn imports_a_real_shape_petdex_zip_without_activating_it() {
        let app_data = tempfile::tempdir().expect("app data");
        let source_directory = tempfile::tempdir().expect("source directory");
        write_petdex_source(source_directory.path());
        let source = tempfile::Builder::new()
            .suffix(".zip")
            .tempfile()
            .expect("zip source");
        {
            let mut archive = zip::ZipWriter::new(source.reopen().expect("zip handle"));
            for name in ["pet.json", "spritesheet.webp"] {
                archive
                    .start_file(name, SimpleFileOptions::default())
                    .expect("zip entry");
                archive
                    .write_all(&fs::read(source_directory.path().join(name)).expect("source file"))
                    .expect("entry bytes");
            }
            archive.finish().expect("finish zip");
        }

        let imported = import_source(app_data.path(), source.path()).expect("import ZIP");
        assert_eq!(imported.id, "local.petdex.sample-fox");
        assert_eq!(imported.source, PetPackSource::Petdex);
        assert!(!imported.active);
        assert!(active_managed_root(app_data.path())
            .expect("active root")
            .is_none());
    }

    #[test]
    fn a_failed_activation_preserves_the_current_selection() {
        let app_data = tempfile::tempdir().expect("app data");
        let source = tempfile::tempdir().expect("source");
        write_petdex_source(source.path());
        let imported = import_source(app_data.path(), source.path()).expect("import");
        activate(app_data.path(), &imported.key).expect("activate");
        let before = active_managed_root(app_data.path()).expect("active root");

        assert!(activate(app_data.path(), "missing-pack").is_err());
        assert_eq!(
            active_managed_root(app_data.path()).expect("active root"),
            before
        );
    }

    #[test]
    fn rejects_zip_path_traversal_without_installing_anything() {
        let app_data = tempfile::tempdir().expect("app data");
        let source = tempfile::Builder::new()
            .suffix(".zip")
            .tempfile()
            .expect("zip source");
        {
            let mut archive = zip::ZipWriter::new(source.reopen().expect("zip handle"));
            archive
                .start_file("../pet.json", SimpleFileOptions::default())
                .expect("unsafe entry");
            archive.write_all(b"{}").expect("entry bytes");
            archive.finish().expect("finish zip");
        }

        let error =
            import_source(app_data.path(), source.path()).expect_err("unsafe ZIP must fail");
        assert!(error.contains("unsafe path"));
        assert!(list_installed(app_data.path())
            .expect("installed")
            .is_empty());
    }

    #[test]
    fn refuses_to_open_a_zip_through_a_symbolic_link() {
        let source = tempfile::Builder::new()
            .suffix(".zip")
            .tempfile()
            .expect("zip source");
        let directory = tempfile::tempdir().expect("link directory");
        let link = directory.path().join("pet.zip");
        symlink(source.path(), &link).expect("zip symlink");

        let error = read_zip_source(&link).expect_err("ZIP symlinks must fail closed");
        assert!(error.contains("safe regular file"));
    }

    #[test]
    fn rejects_petdex_executable_content_and_unknown_manifest_fields() {
        let app_data = tempfile::tempdir().expect("app data");
        let scripted = tempfile::tempdir().expect("scripted source");
        write_petdex_source(scripted.path());
        fs::write(scripted.path().join("script.js"), "alert(1)").expect("script");
        let error = import_source(app_data.path(), scripted.path())
            .expect_err("executable content must fail closed");
        assert!(error.contains("unsupported file"));

        let external = tempfile::tempdir().expect("external source");
        write_petdex_source(external.path());
        fs::write(
            external.path().join("pet.json"),
            r#"{"id":"sample-fox","displayName":"Sample Fox","spritesheetPath":"spritesheet.webp","externalUrl":"https://example.test/script.js"}"#,
        )
        .expect("manifest");
        let error = import_source(app_data.path(), external.path())
            .expect_err("unknown external fields must fail closed");
        assert!(error.contains("pet.json is invalid"));
        assert!(list_installed(app_data.path())
            .expect("installed")
            .is_empty());
    }
}
