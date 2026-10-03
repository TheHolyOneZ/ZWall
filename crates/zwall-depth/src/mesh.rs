

use crate::DepthMap;

pub struct Mesh {

    pub vertices: Vec<[f32; 5]>,
    pub indices: Vec<u32>,
}


pub fn build(_depth: &DepthMap, cols: u32, rows: u32, _strength: f32) -> Mesh {
    let mut vertices = Vec::with_capacity(((cols + 1) * (rows + 1)) as usize);
    for r in 0..=rows {
        for c in 0..=cols {
            let (u, v) = (c as f32 / cols as f32, r as f32 / rows as f32);
            vertices.push([u * 2.0 - 1.0, 1.0 - v * 2.0, 0.0, u, v]);
        }
    }
    let mut indices = Vec::with_capacity((cols * rows * 6) as usize);
    for r in 0..rows {
        for c in 0..cols {
            let i = r * (cols + 1) + c;
            indices.extend_from_slice(&[i, i + cols + 1, i + 1, i + 1, i + cols + 1, i + cols + 2]);
        }
    }
    Mesh { vertices, indices }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_counts() {
        let d = DepthMap { width: 1, height: 1, data: vec![0.5] };
        let m = build(&d, 4, 3, 1.0);
        assert_eq!(m.vertices.len(), 20);
        assert_eq!(m.indices.len(), 72);
    }
}
