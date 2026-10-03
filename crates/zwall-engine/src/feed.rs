

use std::{
    net::{TcpListener, TcpStream},
    sync::{Arc, Mutex},
    time::Duration,
};
use tungstenite::{Message, WebSocket};

pub const PORT: u16 = 47831;

pub struct Feed {
    clients: Mutex<Vec<WebSocket<TcpStream>>>,

    last_state: Mutex<String>,
}

impl Feed {
    pub fn start() -> anyhow::Result<Arc<Self>> {
        let listener = TcpListener::bind(("127.0.0.1", PORT))?;
        let feed = Arc::new(Self { clients: Mutex::new(Vec::new()), last_state: Mutex::new(String::new()) });
        let f = feed.clone();
        std::thread::Builder::new().name("zwall-feed".into()).spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = stream.set_nodelay(true);

                let _ = stream.set_write_timeout(Some(Duration::from_millis(100)));
                match tungstenite::accept(stream) {
                    Ok(mut ws) => {
                        let state = f.last_state.lock().unwrap().clone();
                        if !state.is_empty() && ws.send(Message::text(state)).is_err() {
                            continue;
                        }
                        log::info!("feed: host connected");
                        f.clients.lock().unwrap().push(ws);
                    }
                    Err(e) => log::debug!("feed: handshake failed: {e}"),
                }
            }
        })?;
        log::info!("feed on ws://127.0.0.1:{PORT}");
        Ok(feed)
    }

    pub fn connected(&self) -> bool {
        !self.clients.lock().unwrap().is_empty()
    }


    pub fn state(&self, json: String) {
        {
            let mut last = self.last_state.lock().unwrap();
            if *last == json {
                return;
            }
            last.clone_from(&json);
        }
        self.send(json);
    }

    pub fn send(&self, json: String) {
        let msg = Message::text(json);
        self.clients.lock().unwrap().retain_mut(|ws| ws.send(msg.clone()).is_ok());
    }
}
