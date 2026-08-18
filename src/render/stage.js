import * as THREE from 'three';

// Owns renderer, scene, camera + resize. Everything visual attaches to `stage.scene`.
export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc3d8);
    this.scene.fog = new THREE.Fog(0xcbd8dd, 120, 420);

    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 900);
    this.camera.position.set(0, 12, -34);
    this.camera.lookAt(0, 4, 30);

    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1280, h = c.clientHeight || 720;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
