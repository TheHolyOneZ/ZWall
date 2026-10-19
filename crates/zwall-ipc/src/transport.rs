use std::io::{self, Read, Write};

pub type Reader = Box<dyn Read + Send>;
pub type Writer = Box<dyn Write + Send>;

#[cfg(unix)]
mod imp {
    use super::*;
    use crate::socket_path;
    use std::os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    };

    pub fn connect() -> io::Result<(Reader, Writer)> {
        let s = UnixStream::connect(socket_path())?;
        Ok((Box::new(s.try_clone()?), Box::new(s)))
    }

    pub struct Server(UnixListener);

    impl Server {
        pub fn bind() -> io::Result<Self> {
            let path = socket_path();
            if UnixStream::connect(&path).is_ok() {
                return Err(io::Error::new(io::ErrorKind::AddrInUse, format!("another zwall-engine is already running ({})", path.display())));
            }
            let _ = std::fs::remove_file(&path);
            let l = UnixListener::bind(&path)?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            Ok(Self(l))
        }

        pub fn accept(&self) -> io::Result<(Reader, Writer)> {
            let (s, _) = self.0.accept()?;
            Ok((Box::new(s.try_clone()?), Box::new(s)))
        }

        pub fn cleanup() {
            let _ = std::fs::remove_file(socket_path());
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use interprocess::local_socket::{prelude::*, GenericNamespaced, ListenerOptions, Stream};

    const NAME: &str = "zwall";

    fn name() -> io::Result<interprocess::local_socket::Name<'static>> {
        NAME.to_ns_name::<GenericNamespaced>()
    }

    pub fn connect() -> io::Result<(Reader, Writer)> {
        let (r, w) = Stream::connect(name()?)?.split();
        Ok((Box::new(r), Box::new(w)))
    }

    pub struct Server(interprocess::local_socket::Listener);

    impl Server {
        pub fn bind() -> io::Result<Self> {
            if Stream::connect(name()?).is_ok() {
                return Err(io::Error::new(io::ErrorKind::AddrInUse, "another zwall-engine is already running"));
            }
            Ok(Self(ListenerOptions::new().name(name()?).create_sync()?))
        }

        pub fn accept(&self) -> io::Result<(Reader, Writer)> {
            let (r, w) = self.0.accept()?.split();
            Ok((Box::new(r), Box::new(w)))
        }

        pub fn cleanup() {}
    }
}

pub use imp::{connect, Server};
