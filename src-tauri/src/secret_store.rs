use anyhow::{anyhow, Result};
use std::process::Command;

pub struct SecretStore;

impl SecretStore {
    #[allow(dead_code)]
    const SERVICE_NAME: &'static str = "xitrum-ai-studio";

    /// Lưu mật khẩu / secret vào kho bảo mật OS (Keychain trên macOS, DPAPI/PowerShell trên Windows)
    pub fn set_secret(account: &str, secret: &str) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let status = Command::new("security")
                .args([
                    "add-generic-password",
                    "-U",
                    "-s",
                    Self::SERVICE_NAME,
                    "-a",
                    account,
                    "-w",
                    secret,
                ])
                .status()
                .map_err(|e| anyhow!("Failed to execute security command: {e}"))?;

            if !status.success() {
                return Err(anyhow!("macOS Keychain failed to save secret for account '{}'", account));
            }
            Ok(())
        }

        #[cfg(target_os = "windows")]
        {
            // Sử dụng Windows DPAPI thông qua PowerShell script bảo mật để mã hóa bằng System.Security.Cryptography.ProtectedData
            // DataProtectionScope::CurrentUser
            let ps_script = format!(
                r#"
                $account = "{account}"
                $secret = @'
{secret}
'@
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
                $entropy = [System.Text.Encoding]::UTF8.GetBytes("xitrum_entropy_2026")
                $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
                $b64 = [Convert]::ToBase64String($encrypted)
                $dir = Join-Path $env:LOCALAPPDATA "XitrumAI\credentials"
                if (-not (Test-Path $dir)) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}
                $file = Join-Path $dir "$account.dpapi"
                [System.IO.File]::WriteAllText($file, $b64)
                "#
            );

            let status = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .status()
                .map_err(|e| anyhow!("Failed to execute powershell DPAPI command: {e}"))?;

            if !status.success() {
                return Err(anyhow!("Windows DPAPI failed to save secret for account '{}'", account));
            }
            Ok(())
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err(anyhow!("Secret storage not implemented for this OS"))
        }
    }

    /// Đọc mật khẩu / secret từ kho bảo mật OS
    pub fn get_secret(account: &str) -> Result<Option<String>> {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("security")
                .args([
                    "find-generic-password",
                    "-s",
                    Self::SERVICE_NAME,
                    "-a",
                    account,
                    "-w",
                ])
                .output()
                .map_err(|e| anyhow!("Failed to execute security command: {e}"))?;

            if output.status.success() {
                let s = String::from_utf8(output.stdout)
                    .map_err(|e| anyhow!("Secret output is not valid UTF-8: {e}"))?;
                Ok(Some(s.trim().to_string()))
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                // Mã 44 trong macOS security nghĩa là không tìm thấy item
                if output.status.code() == Some(44) || err_msg.contains("could not be found") {
                    Ok(None)
                } else {
                    Err(anyhow!("macOS Keychain error while reading secret: {}", err_msg.trim()))
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            let ps_script = format!(
                r#"
                $account = "{account}"
                $dir = Join-Path $env:LOCALAPPDATA "XitrumAI\credentials"
                $file = Join-Path $dir "$account.dpapi"
                if (-not (Test-Path $file)) {{
                    Write-Output "__NOT_FOUND__"
                    exit 0
                }}
                $b64 = [System.IO.File]::ReadAllText($file).Trim()
                $encrypted = [Convert]::FromBase64String($b64)
                $entropy = [System.Text.Encoding]::UTF8.GetBytes("xitrum_entropy_2026")
                $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
                $secret = [System.Text.Encoding]::UTF8.GetString($decrypted)
                Write-Output $secret
                "#
            );

            let output = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .output()
                .map_err(|e| anyhow!("Failed to execute powershell DPAPI command: {e}"))?;

            if output.status.success() {
                let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if out_str == "__NOT_FOUND__" {
                    Ok(None)
                } else {
                    Ok(Some(out_str))
                }
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                Err(anyhow!("Windows DPAPI error while reading secret: {}", err_msg.trim()))
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err(anyhow!("Secret storage not implemented for this OS"))
        }
    }

    /// Xóa mật khẩu / secret khỏi kho bảo mật OS
    pub fn delete_secret(account: &str) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("security")
                .args([
                    "delete-generic-password",
                    "-s",
                    Self::SERVICE_NAME,
                    "-a",
                    account,
                ])
                .output()
                .map_err(|e| anyhow!("Failed to execute security command: {e}"))?;

            if output.status.success() || output.status.code() == Some(44) {
                Ok(())
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                Err(anyhow!("macOS Keychain error while deleting secret: {}", err_msg.trim()))
            }
        }

        #[cfg(target_os = "windows")]
        {
            let ps_script = format!(
                r#"
                $account = "{account}"
                $dir = Join-Path $env:LOCALAPPDATA "XitrumAI\credentials"
                $file = Join-Path $dir "$account.dpapi"
                if (Test-Path $file) {{ Remove-Item -Path $file -Force }}
                "#
            );

            let output = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
                .output()
                .map_err(|e| anyhow!("Failed to execute powershell command: {e}"))?;

            if output.status.success() {
                Ok(())
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                Err(anyhow!("Windows DPAPI error while deleting secret: {}", err_msg.trim()))
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err(anyhow!("Secret storage not implemented for this OS"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn test_secret_lifecycle() {
        let test_account = "test_unit_account_macos";
        let test_secret = "secret_pass_998877";

        // Thử ghi (nếu trong môi trường có quyền Keychain)
        if let Ok(()) = SecretStore::set_secret(test_account, test_secret) {
            let read = SecretStore::get_secret(test_account).expect("Get secret");
            assert_eq!(read, Some(test_secret.to_string()));
            SecretStore::delete_secret(test_account).expect("Delete secret");
            let after_delete = SecretStore::get_secret(test_account).expect("Get after delete");
            assert_eq!(after_delete, None);
        }
    }
}

