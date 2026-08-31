use keyring::{error::Error as KeyringError, Entry};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

const LEGACY_SERVICE: &str = "dev.openclaw.pets";
const VAULT_SERVICE: &str = "dev.openclaw.pets.credentials";
const VAULT_ACCOUNT: &str = "credential-vault-v1";
const VAULT_VERSION: u8 = 1;
const MAX_KEY_LENGTH: usize = 1_024;
const MAX_VALUE_LENGTH: usize = 65_536;
const MAX_VAULT_ENTRIES: usize = 64;
const MAX_VAULT_LENGTH: usize = 512 * 1_024;

#[derive(Clone, Debug, Deserialize, Serialize)]
struct CredentialVault {
    version: u8,
    entries: BTreeMap<String, Option<String>>,
}

impl Default for CredentialVault {
    fn default() -> Self {
        Self {
            version: VAULT_VERSION,
            entries: BTreeMap::new(),
        }
    }
}

trait SecretBackend: Send + Sync {
    fn read_vault(&self) -> Result<Option<String>, String>;
    fn write_vault(&self, value: &str) -> Result<(), String>;
    fn read_legacy(&self, account: &str) -> Result<Option<String>, String>;
}

struct KeyringBackend;

impl KeyringBackend {
    fn entry(service: &str, account: &str) -> Result<Entry, String> {
        Entry::new(service, account).map_err(|_| "secure storage is unavailable".into())
    }

    fn read_entry(service: &str, account: &str) -> Result<Option<String>, String> {
        match Self::entry(service, account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err("secure storage read failed".into()),
        }
    }
}

impl SecretBackend for KeyringBackend {
    fn read_vault(&self) -> Result<Option<String>, String> {
        Self::read_entry(VAULT_SERVICE, VAULT_ACCOUNT)
    }

    fn write_vault(&self, value: &str) -> Result<(), String> {
        Self::entry(VAULT_SERVICE, VAULT_ACCOUNT)?
            .set_password(value)
            .map_err(|_| "secure storage write failed".into())
    }

    fn read_legacy(&self, account: &str) -> Result<Option<String>, String> {
        Self::read_entry(LEGACY_SERVICE, account)
    }
}

struct MigratingSecureStore<B> {
    backend: B,
    vault: Mutex<Option<CredentialVault>>,
}

impl<B: SecretBackend> MigratingSecureStore<B> {
    fn new(backend: B) -> Self {
        Self {
            backend,
            vault: Mutex::new(None),
        }
    }

    fn read(&self, key: &str) -> Result<Option<String>, String> {
        validate_key(key)?;
        let mut state = self.lock_vault()?;
        self.load_vault(&mut state)?;
        let vault = state.as_ref().expect("vault loaded");
        if let Some(value) = vault.entries.get(key) {
            return Ok(value.clone());
        }

        let legacy = self.backend.read_legacy(key)?;
        let mut candidate = vault.clone();
        candidate.entries.insert(key.to_string(), legacy.clone());
        self.persist(&candidate)?;
        *state = Some(candidate);
        Ok(legacy)
    }

    fn write(&self, key: &str, value: &str) -> Result<(), String> {
        validate_key(key)?;
        validate_value(value)?;
        let mut state = self.lock_vault()?;
        self.load_vault(&mut state)?;
        let mut candidate = state.as_ref().expect("vault loaded").clone();
        candidate
            .entries
            .insert(key.to_string(), Some(value.to_string()));
        self.persist(&candidate)?;
        *state = Some(candidate);
        Ok(())
    }

    fn tombstone(&self, key: &str) -> Result<(), String> {
        validate_key(key)?;
        let mut state = self.lock_vault()?;
        self.load_vault(&mut state)?;
        let mut candidate = state.as_ref().expect("vault loaded").clone();
        candidate.entries.insert(key.to_string(), None);
        self.persist(&candidate)?;
        *state = Some(candidate);
        Ok(())
    }

    fn lock_vault(&self) -> Result<std::sync::MutexGuard<'_, Option<CredentialVault>>, String> {
        self.vault
            .lock()
            .map_err(|_| "secure storage state is unavailable".into())
    }

    fn load_vault(&self, state: &mut Option<CredentialVault>) -> Result<(), String> {
        if state.is_some() {
            return Ok(());
        }
        *state = Some(match self.backend.read_vault()? {
            Some(encoded) => decode_vault(&encoded)?,
            None => CredentialVault::default(),
        });
        Ok(())
    }

    fn persist(&self, vault: &CredentialVault) -> Result<(), String> {
        validate_vault(vault)?;
        let encoded = serde_json::to_string(vault)
            .map_err(|_| "secure storage vault could not be encoded".to_string())?;
        if encoded.len() > MAX_VAULT_LENGTH {
            return Err("secure storage vault is too large".into());
        }
        self.backend.write_vault(&encoded)
    }
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LENGTH || key.chars().any(char::is_control) {
        return Err("invalid secure storage key".into());
    }
    Ok(())
}

fn validate_value(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_LENGTH {
        return Err("secure storage value is too large".into());
    }
    Ok(())
}

fn validate_vault(vault: &CredentialVault) -> Result<(), String> {
    if vault.version != VAULT_VERSION || vault.entries.len() > MAX_VAULT_ENTRIES {
        return Err("secure storage vault is invalid".into());
    }
    for (key, value) in &vault.entries {
        validate_key(key)?;
        if let Some(value) = value {
            validate_value(value)?;
        }
    }
    Ok(())
}

fn decode_vault(encoded: &str) -> Result<CredentialVault, String> {
    if encoded.len() > MAX_VAULT_LENGTH {
        return Err("secure storage vault is too large".into());
    }
    let vault: CredentialVault =
        serde_json::from_str(encoded).map_err(|_| "secure storage vault is invalid".to_string())?;
    validate_vault(&vault)?;
    Ok(vault)
}

fn store() -> &'static MigratingSecureStore<KeyringBackend> {
    static STORE: OnceLock<MigratingSecureStore<KeyringBackend>> = OnceLock::new();
    STORE.get_or_init(|| MigratingSecureStore::new(KeyringBackend))
}

pub fn read_secret(key: &str) -> Result<Option<String>, String> {
    store().read(key)
}

pub fn write_secret(key: &str, value: &str) -> Result<(), String> {
    store().write(key, value)
}

pub fn tombstone_secret(key: &str) -> Result<(), String> {
    store().tombstone(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;

    #[derive(Clone, Default)]
    struct FakeBackend {
        values: Arc<Mutex<HashMap<(String, String), String>>>,
        reads: Arc<Mutex<HashMap<(String, String), usize>>>,
        writes: Arc<Mutex<HashMap<(String, String), usize>>>,
    }

    impl FakeBackend {
        fn insert(&self, service: &str, account: &str, value: &str) {
            self.values.lock().unwrap().insert(
                (service.to_string(), account.to_string()),
                value.to_string(),
            );
        }

        fn count(
            &self,
            counts: &Mutex<HashMap<(String, String), usize>>,
            service: &str,
            account: &str,
        ) -> usize {
            *counts
                .lock()
                .unwrap()
                .get(&(service.to_string(), account.to_string()))
                .unwrap_or(&0)
        }
    }

    impl SecretBackend for FakeBackend {
        fn read_vault(&self) -> Result<Option<String>, String> {
            self.read(VAULT_SERVICE, VAULT_ACCOUNT)
        }

        fn write_vault(&self, value: &str) -> Result<(), String> {
            self.write(VAULT_SERVICE, VAULT_ACCOUNT, value)
        }

        fn read_legacy(&self, account: &str) -> Result<Option<String>, String> {
            self.read(LEGACY_SERVICE, account)
        }
    }

    impl FakeBackend {
        fn read(&self, service: &str, account: &str) -> Result<Option<String>, String> {
            *self
                .reads
                .lock()
                .unwrap()
                .entry((service.to_string(), account.to_string()))
                .or_default() += 1;
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(service.to_string(), account.to_string()))
                .cloned())
        }

        fn write(&self, service: &str, account: &str, value: &str) -> Result<(), String> {
            *self
                .writes
                .lock()
                .unwrap()
                .entry((service.to_string(), account.to_string()))
                .or_default() += 1;
            self.insert(service, account, value);
            Ok(())
        }
    }

    #[test]
    fn migrates_legacy_secrets_once_and_reloads_the_single_vault() {
        let backend = FakeBackend::default();
        backend.insert(LEGACY_SERVICE, "device-signing-key-v2", "private-key");
        backend.insert(LEGACY_SERVICE, "gateway-token:current", "device-token");
        let store = MigratingSecureStore::new(backend.clone());

        assert_eq!(
            store.read("device-signing-key-v2").unwrap().as_deref(),
            Some("private-key")
        );
        assert_eq!(
            store.read("device-signing-key-v2").unwrap().as_deref(),
            Some("private-key")
        );
        assert_eq!(
            store.read("gateway-token:current").unwrap().as_deref(),
            Some("device-token")
        );
        assert_eq!(
            backend.count(&backend.reads, LEGACY_SERVICE, "device-signing-key-v2"),
            1
        );
        assert_eq!(
            backend.count(&backend.reads, LEGACY_SERVICE, "gateway-token:current"),
            1
        );

        let restarted = MigratingSecureStore::new(backend.clone());
        assert_eq!(
            restarted.read("device-signing-key-v2").unwrap().as_deref(),
            Some("private-key")
        );
        assert_eq!(
            restarted.read("gateway-token:current").unwrap().as_deref(),
            Some("device-token")
        );
        assert_eq!(
            backend.count(&backend.reads, LEGACY_SERVICE, "device-signing-key-v2"),
            1
        );
        assert_eq!(
            backend.count(&backend.reads, LEGACY_SERVICE, "gateway-token:current"),
            1
        );
    }

    #[test]
    fn records_missing_legacy_entries_so_reconnects_do_not_probe_again() {
        let backend = FakeBackend::default();
        let store = MigratingSecureStore::new(backend.clone());

        assert_eq!(
            store.read("gateway-connection-credential:local").unwrap(),
            None
        );
        assert_eq!(
            store.read("gateway-connection-credential:local").unwrap(),
            None
        );

        let restarted = MigratingSecureStore::new(backend.clone());
        assert_eq!(
            restarted
                .read("gateway-connection-credential:local")
                .unwrap(),
            None
        );
        assert_eq!(
            backend.count(
                &backend.reads,
                LEGACY_SERVICE,
                "gateway-connection-credential:local"
            ),
            1
        );
    }

    #[test]
    fn tombstones_without_deleting_the_recovery_copy() {
        let backend = FakeBackend::default();
        backend.insert(LEGACY_SERVICE, "gateway-token:current", "recovery-token");
        let store = MigratingSecureStore::new(backend.clone());

        assert_eq!(
            store.read("gateway-token:current").unwrap().as_deref(),
            Some("recovery-token")
        );
        store.tombstone("gateway-token:current").unwrap();
        assert_eq!(store.read("gateway-token:current").unwrap(), None);
        assert_eq!(
            backend
                .values
                .lock()
                .unwrap()
                .get(&(
                    LEGACY_SERVICE.to_string(),
                    "gateway-token:current".to_string()
                ))
                .map(String::as_str),
            Some("recovery-token")
        );
    }

    #[test]
    fn rejects_an_invalid_existing_vault() {
        let backend = FakeBackend::default();
        backend.insert(
            VAULT_SERVICE,
            VAULT_ACCOUNT,
            r#"{"version":2,"entries":{}}"#,
        );
        let store = MigratingSecureStore::new(backend);

        assert!(store
            .read("device-signing-key-v2")
            .unwrap_err()
            .contains("vault is invalid"));
    }
}
