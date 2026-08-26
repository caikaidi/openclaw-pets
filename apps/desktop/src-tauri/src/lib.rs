use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ed25519_dalek::{Signer, SigningKey};
use image::{ImageFormat, ImageReader, Limits};
use keyring::{error::Error as KeyringError, Entry};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::Path;
use tauri::Manager;
use walkdir::WalkDir;

mod pet_packs;

const KEYRING_SERVICE: &str = "dev.openclaw.pets";
const DEVICE_KEY: &str = "device-signing-key-v2";
const MAX_KEY_LENGTH: usize = 1_024;
const MAX_VALUE_LENGTH: usize = 65_536;
const MAX_SIGNING_PAYLOAD_LENGTH: usize = 16_384;
const MAX_PACK_MANIFEST_LENGTH: u64 = 65_536;
const MAX_PACK_ASSET_LENGTH: u64 = 16 * 1024 * 1024;
const MAX_PACK_TOTAL_LENGTH: u64 = 32 * 1024 * 1024;
const MAX_PACK_ASSETS: usize = 32;
const MAX_PACK_DIMENSION: u32 = 8_192;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentity {
    device_id: String,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PetPackAsset {
    path: String,
    mime_type: String,
    base64: String,
}

#[derive(Serialize)]
struct PetPackPayload {
    manifest: String,
    assets: Vec<PetPackAsset>,
}

#[derive(Deserialize)]
struct NativePackManifest {
    assets: HashMap<String, NativePackAsset>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePackAsset {
    path: String,
    mime_type: String,
    width: u32,
    height: u32,
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LENGTH || key.chars().any(char::is_control) {
        return Err("invalid secure storage key".into());
    }
    Ok(())
}

fn entry(key: &str) -> Result<Entry, String> {
    validate_key(key)?;
    Entry::new(KEYRING_SERVICE, key).map_err(|_| "secure storage is unavailable".into())
}

fn read_secret(key: &str) -> Result<Option<String>, String> {
    match entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(_) => Err("secure storage read failed".into()),
    }
}

fn write_secret(key: &str, value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_LENGTH {
        return Err("secure storage value is too large".into());
    }
    entry(key)?
        .set_password(value)
        .map_err(|_| "secure storage write failed".into())
}

fn signing_key() -> Result<SigningKey, String> {
    if let Some(encoded) = read_secret(DEVICE_KEY)? {
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "stored device identity is invalid".to_string())?;
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "stored device identity is invalid".to_string())?;
        return Ok(SigningKey::from_bytes(&seed));
    }

    let key = SigningKey::generate(&mut OsRng);
    write_secret(DEVICE_KEY, &URL_SAFE_NO_PAD.encode(key.to_bytes()))?;
    Ok(key)
}

#[tauri::command]
fn device_identity() -> Result<DeviceIdentity, String> {
    let key = signing_key()?;
    let public_bytes = key.verifying_key().to_bytes();
    let device_id = format!("{:x}", Sha256::digest(public_bytes));
    Ok(DeviceIdentity {
        device_id,
        public_key: URL_SAFE_NO_PAD.encode(public_bytes),
    })
}

#[tauri::command]
fn sign_device_payload(payload: String) -> Result<String, String> {
    if payload.len() > MAX_SIGNING_PAYLOAD_LENGTH {
        return Err("device signing payload is too large".into());
    }
    let signature = signing_key()?.sign(payload.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(signature.to_bytes()))
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    read_secret(&key)
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    write_secret(&key, &value)
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err("secure storage delete failed".into()),
    }
}

#[tauri::command]
fn read_active_pet_pack(app: tauri::AppHandle) -> Result<Option<PetPackPayload>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "application data directory is unavailable".to_string())?;
    if let Some(root) = pet_packs::active_managed_root(&app_data)? {
        return read_pet_pack_root(&root).map(Some);
    }
    let root = app_data.join("pet-packs").join("active");
    match fs::symlink_metadata(&root) {
        Ok(_) => read_pet_pack_root(&root).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Pet Pack root is unavailable".into()),
    }
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "application data directory is unavailable".to_string())
}

#[tauri::command]
fn import_pet_pack(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<pet_packs::PetPackSummary, String> {
    pet_packs::import_source(&app_data_dir(&app)?, Path::new(&source_path))
}

#[tauri::command]
fn list_pet_packs(app: tauri::AppHandle) -> Result<Vec<pet_packs::PetPackSummary>, String> {
    pet_packs::list_installed(&app_data_dir(&app)?)
}

#[tauri::command]
fn read_pet_pack(app: tauri::AppHandle, key: String) -> Result<PetPackPayload, String> {
    let root = pet_packs::installed_root(&app_data_dir(&app)?, &key)?;
    read_pet_pack_root(&root)
}

#[tauri::command]
fn activate_pet_pack(app: tauri::AppHandle, key: String) -> Result<(), String> {
    pet_packs::activate(&app_data_dir(&app)?, &key)
}

#[tauri::command]
fn remove_pet_pack(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    pet_packs::remove(&app_data_dir(&app)?, &key)
}

fn read_pet_pack_root(root: &Path) -> Result<PetPackPayload, String> {
    let root_metadata =
        fs::symlink_metadata(root).map_err(|_| "Pet Pack root is unavailable".to_string())?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err("Pet Pack root is not a safe directory".into());
    }
    if let Some(parent) = root.parent() {
        let parent_metadata = fs::symlink_metadata(parent)
            .map_err(|_| "Pet Pack parent is unavailable".to_string())?;
        if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
            return Err("Pet Pack parent is not a safe directory".into());
        }
    }

    let manifest_path = root.join("manifest.json");
    let manifest_metadata = fs::symlink_metadata(&manifest_path)
        .map_err(|_| "Pet Pack manifest is unavailable".to_string())?;
    if !manifest_metadata.is_file()
        || manifest_metadata.file_type().is_symlink()
        || manifest_metadata.len() > MAX_PACK_MANIFEST_LENGTH
    {
        return Err("Pet Pack manifest is not a safe regular file".into());
    }
    let manifest = fs::read_to_string(&manifest_path)
        .map_err(|_| "Pet Pack manifest could not be read".to_string())?;
    let parsed: NativePackManifest = serde_json::from_str(&manifest)
        .map_err(|_| "Pet Pack manifest is not valid JSON".to_string())?;
    if parsed.assets.is_empty() || parsed.assets.len() > MAX_PACK_ASSETS {
        return Err("Pet Pack manifest has an invalid asset count".into());
    }
    let mut declared_assets = HashMap::new();
    for asset in parsed.assets.values() {
        if declared_assets.insert(asset.path.as_str(), asset).is_some() {
            return Err("Pet Pack asset paths must be unique".into());
        }
    }

    let assets_root = root.join("assets");
    let assets_metadata = fs::symlink_metadata(&assets_root)
        .map_err(|_| "Pet Pack assets directory is unavailable".to_string())?;
    if !assets_metadata.is_dir() || assets_metadata.file_type().is_symlink() {
        return Err("Pet Pack assets path is not a safe directory".into());
    }

    let mut assets = Vec::new();
    let mut total_length = 0_u64;
    for entry in WalkDir::new(&assets_root).follow_links(false) {
        let entry = entry.map_err(|_| "Pet Pack assets could not be enumerated".to_string())?;
        if entry.depth() > 5 {
            return Err("Pet Pack assets are nested too deeply".into());
        }
        if entry.depth() == 0 || entry.file_type().is_dir() {
            continue;
        }
        if entry.file_type().is_symlink() || !entry.file_type().is_file() {
            return Err("Pet Pack assets may not contain links or special files".into());
        }
        let extension = entry
            .path()
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        let (mime_type, expected_format) = match extension.as_deref() {
            Some("png") => ("image/png", ImageFormat::Png),
            Some("webp") => ("image/webp", ImageFormat::WebP),
            _ => return Err("Pet Pack assets must contain only PNG or WebP files".into()),
        };
        let metadata = entry
            .metadata()
            .map_err(|_| "Pet Pack asset metadata is unavailable".to_string())?;
        if metadata.len() > MAX_PACK_ASSET_LENGTH {
            return Err("Pet Pack asset exceeds the size limit".into());
        }
        total_length = total_length.saturating_add(metadata.len());
        if total_length > MAX_PACK_TOTAL_LENGTH {
            return Err("Pet Pack assets exceed the total size limit".into());
        }
        let bytes =
            fs::read(entry.path()).map_err(|_| "Pet Pack asset could not be read".to_string())?;
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|_| "Pet Pack asset path is invalid".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let declared = declared_assets
            .remove(relative.as_str())
            .ok_or_else(|| "Pet Pack contains an undeclared asset".to_string())?;
        if declared.mime_type != mime_type {
            return Err("Pet Pack asset MIME type does not match its file".into());
        }
        let mut reader = ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(|_| "Pet Pack asset is not a valid PNG or WebP".to_string())?;
        if reader.format() != Some(expected_format) {
            return Err("Pet Pack asset is not a valid PNG or WebP".into());
        }
        let mut limits = Limits::default();
        limits.max_image_width = Some(MAX_PACK_DIMENSION);
        limits.max_image_height = Some(MAX_PACK_DIMENSION);
        reader.limits(limits);
        let image = reader
            .decode()
            .map_err(|_| "Pet Pack asset is not a valid PNG or WebP".to_string())?;
        if image.width() != declared.width || image.height() != declared.height {
            return Err("Pet Pack asset dimensions do not match the manifest".into());
        }
        assets.push(PetPackAsset {
            path: relative,
            mime_type: mime_type.into(),
            base64: STANDARD.encode(bytes),
        });
    }
    if !declared_assets.is_empty() {
        return Err("Pet Pack manifest references a missing asset".into());
    }
    Ok(PetPackPayload { manifest, assets })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                app.set_dock_visibility(false);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            device_identity,
            sign_device_payload,
            secure_get,
            secure_set,
            secure_delete,
            read_active_pet_pack,
            import_pet_pack,
            list_pet_packs,
            read_pet_pack,
            activate_pet_pack,
            remove_pet_pack,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OpenClaw Pets");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(path: &str, mime_type: &str) -> String {
        format!(
            r#"{{"assets":{{"main":{{"path":"{path}","mimeType":"{mime_type}","width":1,"height":1}}}}}}"#
        )
    }

    #[test]
    fn rejects_an_active_pack_root_symlink() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let target = directory.path().join("target");
        fs::create_dir(&target).expect("target directory");
        let root = directory.path().join("active");
        std::os::unix::fs::symlink(&target, &root).expect("active symlink");

        expect_err_contains(read_pet_pack_root(&root), "safe directory");
    }

    #[test]
    fn rejects_assets_nested_beyond_four_directories() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let root = directory.path().join("active");
        let asset = root.join("assets/a/b/c/d/e/deep.png");
        fs::create_dir_all(asset.parent().expect("asset parent")).expect("asset directories");
        fs::write(
            root.join("manifest.json"),
            manifest("assets/a/b/c/d/e/deep.png", "image/png"),
        )
        .expect("manifest");
        fs::write(asset, b"not-an-image").expect("asset");

        expect_err_contains(read_pet_pack_root(&root), "nested too deeply");
    }

    #[test]
    fn rejects_extension_spoofed_raster_assets() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let root = directory.path().join("active");
        fs::create_dir_all(root.join("assets")).expect("assets directory");
        fs::write(
            root.join("manifest.json"),
            manifest("assets/fake.png", "image/png"),
        )
        .expect("manifest");
        fs::write(root.join("assets/fake.png"), b"not-an-image").expect("asset");

        expect_err_contains(read_pet_pack_root(&root), "valid PNG or WebP");
    }

    fn expect_err_contains(result: Result<PetPackPayload, String>, expected: &str) {
        let error = result.err().expect("expected Pet Pack rejection");
        assert!(
            error.contains(expected),
            "expected {error:?} to contain {expected:?}"
        );
    }
}
