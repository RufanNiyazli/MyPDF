

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // opener plugin lazım deyilsə silə bilərsən
        .plugin(tauri_plugin_fs::init())       // fs plugin
        .plugin(tauri_plugin_dialog::init())   // dialog plugin
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}