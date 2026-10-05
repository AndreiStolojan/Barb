// Opens the window declared in tauri.conf.json. No custom commands or plugins:
// the React app talks to the Barb API over HTTPS like the website does.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Barb app");
}
