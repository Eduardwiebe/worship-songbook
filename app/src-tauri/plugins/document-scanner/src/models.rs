use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
  pub max_pages: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedPage {
  /// JPEG data URL (data:image/jpeg;base64,...)
  pub data_url: String,
  pub width: u32,
  pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
  pub pages: Vec<ScannedPage>,
  pub cancelled: bool,
}
