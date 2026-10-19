use std::{
    io::BufReader,
    sync::{
        atomic::{AtomicBool, Ordering::Relaxed},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use zwall_ipc::{read_msg, transport, write_msg, Event, Request, State};

pub struct Link {
    app: AppHandle,
    conn: Mutex<Option<transport::Writer>>,
    state: Mutex<Option<State>>,
    connected: AtomicBool,
}

impl Link {
    pub fn start(app: AppHandle) -> Arc<Self> {
        let link = Arc::new(Self { app, conn: Mutex::new(None), state: Mutex::new(None), connected: AtomicBool::new(false) });
        let l = link.clone();
        thread::Builder::new().name("zwall-link".into()).spawn(move || l.run()).expect("spawn link");
        link
    }

    pub fn connected(&self) -> bool {
        self.connected.load(Relaxed)
    }

    pub fn state(&self) -> Option<State> {
        self.state.lock().unwrap().clone()
    }

    pub fn send(&self, req: &Request) -> std::io::Result<()> {
        match self.conn.lock().unwrap().as_mut() {
            Some(c) => write_msg(c, req),
            None => Err(std::io::Error::new(std::io::ErrorKind::NotConnected, "engine not running")),
        }
    }

    fn run(self: Arc<Self>) {
        let mut backoff = Duration::from_millis(200);
        let mut woke = false;
        loop {
            match transport::connect() {
                Ok((r, w)) => {
                    backoff = Duration::from_millis(200);
                    if let Err(e) = self.session(r, w) {
                        eprintln!("zwall: engine connection ended: {e}");
                    }
                    *self.conn.lock().unwrap() = None;
                    *self.state.lock().unwrap() = None;
                    self.connected.store(false, Relaxed);
                    let _ = self.app.emit("zwall://connection", false);
                    crate::tray::update(&self.app, None);
                }
                Err(_) => {
                    if !woke {
                        woke = true;
                        if let Err(e) = crate::wake_engine_now(&self.app) {
                            eprintln!("zwall: {e}");
                            let _ = self.app.emit("zwall://error", e);
                        }
                    }
                    backoff = (backoff * 2).min(Duration::from_secs(2));
                }
            }
            thread::sleep(backoff);
        }
    }

    fn session(&self, r: transport::Reader, w: transport::Writer) -> std::io::Result<()> {
        *self.conn.lock().unwrap() = Some(w);
        self.connected.store(true, Relaxed);
        let _ = self.app.emit("zwall://connection", true);
        eprintln!("zwall: connected to engine");
        let mut r = BufReader::new(r);
        let mut buf = String::new();
        while let Some(ev) = read_msg::<_, Event>(&mut r, &mut buf).inspect_err(|e| eprintln!("zwall: bad message from engine: {e}"))? {
            match ev {
                Event::State(s) => {
                    *self.state.lock().unwrap() = Some((*s).clone());
                    crate::tray::update(&self.app, Some(&s));
                    let _ = self.app.emit("zwall://state", &*s);
                }
                Event::Error(e) => {
                    let _ = self.app.emit("zwall://error", e);
                }
                Event::Notice(n) => {
                    let _ = self.app.emit("zwall://notice", n);
                }
            }
        }
        Ok(())
    }
}
