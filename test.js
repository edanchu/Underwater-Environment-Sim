import { tiny, defs } from './examples/common.js';
import { Quaternion, quat } from './Quaternion.js';
import { utils } from './utils.js';
import { shaders } from './shaders.js';
import { Shape_From_File } from './examples/obj-file-demo.js';
import { objects } from './objects.js';

const { vec3, vec4, color, Mat4, Shape, Shader, Texture, Component } = tiny;

export class Test extends Component {
  init() {
    this.createShapes();
    this.createTextures();
    this.createMaterials();
    this.createSceneObjects();

    this.FBOs = {};
    this.gTextures = {};
    this.lTextures = {};
    this.pTextures = {};
    this.lightDepthTexture = null;

    this.uniforms.pointLights = []// [new utils.Light(vec4(0, 4, 15, 1.0), color(0, 0.5, 1, 1), 50, 1)], new utils.Light(vec4(0, 0, -13, 1.0), color(1, 1, 1, 1), 3, 1)];
    this.uniforms.directionalLights = [new utils.Light(vec4(5, 35, 5, 0.0), color(0.944, 0.984, 0.991, 1), 7.0, 1)];
  }

  render_animation(context) {
    const gl = context.context;
    if (this.textures.HDRI.ready != true) return;

    if (!context.controls /*checks if first animated frame*/) {
      this.firstTimeSetup(context);
    }

    const t = this.t = this.uniforms.animation_time / 1000;
    const dt = this.dt = this.uniforms.animation_delta_time / 1000;

    const fixedTimeStep = 0.001;
    for (let i = 0; i < dt; i += fixedTimeStep) {
      this.sceneObjects.map((x) => x.fixedUpdate(this.sceneObjects, this.uniforms, fixedTimeStep));
    }
    this.sceneObjects.map((x) => x.update(this.sceneObjects, this.uniforms, dt));

    this.render(context);
  }

  render(context) {
    const gl = context.context;

    //draw light depth buffer for sun shadows
    this.drawSunShadows(context);

    this.bindGBuffer(gl, this.FBOs.gBuffer);

    //deferred geometry
    this.sceneObjects.map((x) => { if (x.pass == "deferred") x.draw(context, this.uniforms) });

    //lights
    this.bindLBufferForLights(gl, this.FBOs.lBuffer);

    this.uniforms.pointLights.map((x, i) => this.shapes.lightVolume.draw(context, this.uniforms, Mat4.translation(x.position[0], x.position[1], x.position[2]).times(Mat4.scale(x.radius, x.radius, x.radius)), { ...this.materials.lightingMaterial, index: i }));
    this.uniforms.directionalLights.map((x, i) => this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), { ...this.materials.directionalLightingMaterial, index: i }, "TRIANGLE_STRIP"));
    this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), this.materials.ambientMaterial, "TRIANGLE_STRIP");

    //forward pass
    this.prepForForwardPass(gl, this.FBOs.lBuffer, this.FBOs.gBuffer);
    this.sceneObjects.map((x) => { if (x.pass == "forward") x.draw(context, this.uniforms) });
    this.sceneObjects.map((x) => { if (x.pass == "transparent") x.draw(context, this.uniforms) });

    //postprocess
    this.depthFogPass(context);
    this.volumePass(context);
    this.bloom(5, context);

    // //copy to screen
    this.drawToScreen(context);
  }

  createSceneObjects() {
    this.sceneObjects = [];
    this.sceneObjects.push(new objects.WaterPlane(this.shapes.plane, this.materials.water, Mat4.translation(this.uniforms.camera_transform[0][3], 20, this.uniforms.camera_transform[2][3]), "water", "forward", "TRIANGLE_STRIP", false));
    this.sceneObjects.push(new utils.SceneObject(this.shapes.ball, { ...this.materials.plastic, color: color(.09 / 2, 0.195 / 2, 0.33 / 2, 1.0), ambient: 1.0, diffusivity: 0.0, specularity: 0.0 }, Mat4.scale(500, 500, 500), "skybox", "forward"));
    this.sceneObjects.push(new utils.SceneObject(this.shapes.plane, this.materials.sand, Mat4.translation(0, -80, 0).times(Mat4.scale(10, 1, 10)), "ground", "deferred", "TRIANGLE_STRIP", false, this.materials.basicShadow));
    // this.sceneObjects.push(new objects.trout(this.shapes.trout, this.materials.trout, Mat4.identity(), "trout", "deferred", "TRIANGLES", true, this.materials.fishShadow));
    // this.sceneObjects.push(new utils.SceneObject(this.shapes.ball, this.materials.geometryMaterial, Mat4.translation(-10, 0, 0).times(Mat4.scale(3, 3, 3)), "ball", "deferred", "TRIANGLES", true, this.materials.basicShadow));
    // this.sceneObjects.push(new utils.SceneObject(this.shapes.shark, this.materials.shark, Mat4.translation(-30, 0, 0).times(Mat4.scale(5, 5, 5)), "shark", "deferred", "TRIANGLES", true, this.materials.basicShadow));

    const trout = new objects.trout(this.shapes.trout, this.materials.trout, Mat4.identity(), "trout", "deferred", "TRIANGLES", true, this.materials.fishShadow);
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 10, vec3(30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids2", 10, vec3(-30, 0, 0)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids3", 10, vec3(0, 0, -30)));
    this.sceneObjects.push(new objects.boidsController(trout, "boids4", 10, vec3(0, 0, 30)));
  }

  createShapes() {
    this.shapes = {};
    this.planeSize = 300;
    this.shapes.ball = new defs.Subdivision_Sphere(6);
    this.shapes.lightVolume = new defs.Subdivision_Sphere(4);
    this.shapes.quad = new utils.ScreenQuad(true);
    this.shapes.cube = new defs.Cube();
    this.shapes.orca = new defs.Shape_From_File("assets/meshes/orca/orca.obj");
    this.shapes.trout = new defs.Shape_From_File('assets/meshes/trout/trout.obj');
    this.shapes.shark = new defs.Shape_From_File('assets/meshes/shark/shark.obj');
    this.shapes.plane = new utils.TriangleStripPlane(this.planeSize, this.planeSize, vec3(0, 0, 0), 1);
  }

  createMaterials() {
    this.materials = {};
    this.materials.plastic = { shader: new defs.Phong_Shader(), ambient: .2, diffusivity: 1, specularity: .5, color: vec4(0.9, 0.5, 0.9, 1.0) };

    this.materials.geometryMaterial = { shader: new shaders.GeometryShader(), color: vec4(0.5, 0.5, 0.5, 1.0), specularColor: vec4(0.8, 1, 0.03, 0.5) };
    this.materials.directionalLightingMaterial = { shader: new shaders.DirectionalLightShader(), gTextures: () => this.gTextures, index: null, lightDepthTexture: () => this.lightDepthTexture, sunView: () => this.sunView, sunProj: () => this.sunProj };
    this.materials.ambientMaterial = { shader: new shaders.AmbientLightShader(), gTextures: () => this.gTextures, cTextures: () => this.cTextures };
    this.materials.brightCopyMat = { shader: new shaders.CopyBright(), lTextures: () => this.lTextures, threshold: 1.0 };
    this.materials.copyMat = { shader: new shaders.CopyToDefaultFB(), basic: () => this.pTextures.pGen3, post: () => this.pTextures.pGen2, exposure: 1.0, depth: () => this.lTextures.lDepth };
    this.materials.blurMat = { shader: new shaders.GBlur(), from: () => this.pTextures.gBright, horizontal: false };
    this.materials.volumeMat = { shader: new shaders.VolumetricShader(), pGen2: () => this.pTextures.pGen2, lightDepthTexture: () => this.lightDepthTexture, sunViewOrig: () => this.sunViewOrig, sunView: () => this.sunView, sunProj: () => this.sunProj, lTextures: () => this.lTextures, caustics: this.textures.caustic };
    this.materials.depthFogMat = { shader: new shaders.DepthFogShader(), lTextures: () => this.lTextures };

    this.materials.basicShadow = { shader: new shaders.ShadowShaderBase(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.fishShadow = { shader: new shaders.FishShadowShader(), proj: () => this.sunProj, view: () => this.sunView };

    this.materials.water = {
      shader: new shaders.WaterSurfaceShader(),
      color: color(0.3, 0.7, 1, 1),
      gTextures: () => this.gTextures,
      waterFlow: new Texture('assets/textures/water/flow_speed_noise.png'),
      waterDerivativeHeight: new Texture('assets/textures/water/water_derivative_height.png'),
      planeSize: this.planeSize,
      specularity: 6.8,
      ambient: 0.3,
      diffusivity: 0.6,
      smoothness: 10
    };

    this.materials.sand = { shader: new shaders.GeometryShaderTextured(), ambientScale: 1 / 5, textureScale: 100, texAlbedo: new Texture("assets/textures/sand/sand_albedo.png"), texARM: new Texture("assets/textures/sand/sand_arm.png"), texNormal: new Texture("assets/textures/sand/sand_norm.png") };
    this.materials.trout = { shader: new shaders.FishGeometryShader(), texAlbedo: new Texture('assets/meshes/trout/CoralTrout.png'), roughness: 0.8, metallic: 0.35, ambient: 2.0 };
    this.materials.shark = { shader: new shaders.GeometryShaderTexturedMinimal(), texAlbedo: new Texture('/assets/meshes/shark/GreatWhiteShark.png'), roughness: 0.8, metallic: 0.35, ambient: 2.0 };
  }

  createTextures() {
    this.textures = {};
    this.textures.HDRI = new utils.HDRTexture('/assets/textures/maps/hdr.hdr');
    this.textures.caustic = new Texture('/assets/textures/misc/caust_001.png');
  }

  firstTimeSetup(context) {
    const gl = context.context;
    let [_FBOs, _gTextures, _lTextures, _pTextures, _cTextures, _lightDepthTexture, _lightColorTexture] = this.framebufferInit(gl, 8192, gl.canvas.width, gl.canvas.height);
    this.FBOs = _FBOs, this.gTextures = _gTextures, this.lTextures = _lTextures, this.pTextures = _pTextures, this.cTextures = _cTextures, this.lightDepthTexture = _lightDepthTexture, this.lightColorTexture = _lightColorTexture;

    this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 0.5, 1000);

    this.animated_children.push(context.controls = new utils.CustomMovementControls({ uniforms: this.uniforms }));
    context.controls.add_mouse_controls(context.canvas);
    Shader.assign_camera(Mat4.look_at(vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0)), this.uniforms);

    this.convolveCubemaps(context, this.FBOs.cBuffer, this.cTextures, this.shapes.cube, this.textures.HDRI);

    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  depthFogPass(context) {
    const gl = context.context;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.pBuffer3);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), this.materials.depthFogMat, "TRIANGLE_STRIP");
  }

  volumePass(context) {
    const gl = context.context;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.pBuffer3);
    gl.enable(gl.BLEND);

    this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), this.materials.volumeMat, "TRIANGLE_STRIP");
  }

  drawSunShadows(context) {
    const gl = context.context;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.lightDepthFramebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, 8192, 8192);

    this.uniforms.directionalLights[0].updatePosition(vec4(this.uniforms.camera_transform[0][3], 35, this.uniforms.camera_transform[2][3], 0));

    if (this.sunViewOrig == undefined) {
      this.sunViewOrig = Mat4.look_at(this.uniforms.directionalLights[0].position.copy(), this.uniforms.directionalLights[0].position.to3().minus(this.uniforms.directionalLights[0].direction.to3()), vec3(0, 1, 0));
      this.sunProj = Mat4.orthographic(-300, 300, -300, 300, 0.5, 150);
      // this.sunProj = Mat4.perspective(140 * Math.PI / 180, 1, 0.5, 150);
    }
    this.sunView = Mat4.look_at(this.uniforms.directionalLights[0].position.copy(), this.uniforms.directionalLights[0].position.to3().minus(this.uniforms.directionalLights[0].direction.to3()), vec3(0, 1, 0));

    this.sceneObjects.map((x) => { if (x.pass == "deferred" && x.castShadows == true) x.drawShadow(context, this.uniforms) });
    gl.viewport(0, 0, context.canvas.width, context.canvas.height);
  }

  convolveCubemaps(context) {
    const gl = context.context;
    const cubeMat = { shader: new shaders.CubemapShader(), texture: this.textures.HDRI };
    const convMat = { shader: new shaders.ConvolveShader(), envMap: this.cTextures.cEnvCube };
    const proj = Mat4.perspective(90 * Math.PI / 180, 1, 0.1, 10);
    const views = [
      Mat4.look_at(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, -1, 0)), Mat4.look_at(vec3(0, 0, 0), vec3(-1, 0, 0), vec3(0, -1, 0)),
      Mat4.look_at(vec3(0, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)), Mat4.look_at(vec3(0, 0, 0), vec3(0, -1, 0), vec3(0, 0, -1)),
      Mat4.look_at(vec3(0, 0, 0), vec3(0, 0, 1), vec3(0, -1, 0)), Mat4.look_at(vec3(0, 0, 0), vec3(0, 0, -1), vec3(0, -1, 0))
    ];

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.cBuffer);
    gl.viewport(0, 0, 512, 512);
    for (let i = 0; i < 6; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.cTextures.cEnvCube.texture_buffer_pointer, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.shapes.cube.draw(context, null, Mat4.identity(), { ...cubeMat, projTransform: proj, cameraInverse: views[i] });
    }

    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 32, 32);
    gl.viewport(0, 0, 32, 32);
    for (let i = 0; i < 6; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, this.cTextures.cIrradiance.texture_buffer_pointer, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.shapes.cube.draw(context, null, Mat4.identity(), { ...convMat, projTransform: proj, cameraInverse: views[i] });
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  }

  bloom(iterations, context) {
    const gl = context.context;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.pBuffer1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);

    this.shapes.quad.draw(context, null, null, this.materials.brightCopyMat, "TRIANGLE_STRIP");

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.pBuffer2);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    for (let i = 0; i < iterations; ++i) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.pBuffer2);
      this.shapes.quad.draw(context, null, null, { ...this.materials.blurMat, from: () => this.pTextures.pGen1, horizontal: true }, "TRIANGLE_STRIP");
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.pBuffer1);
      this.shapes.quad.draw(context, null, null, { ...this.materials.blurMat, from: () => this.pTextures.pGen2, horizontal: false }, "TRIANGLE_STRIP");
    }
  }

  drawToScreen(context) {
    const gl = context.context;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.shapes.quad.draw(context, this.uniforms, null, { ...this.materials.copyMat, exposure: 1.0 }, "TRIANGLE_STRIP");
  }

  framebufferInit(gl, lightDepthTextureSize, screenWidth, screenHeight) {
    let gTextures = {};
    let lTextures = {};
    let pTextures = {};
    let cTextures = {};
    let FBOs = {};

    if (!gl.getExtension("EXT_color_buffer_float")) {
      console.error("FLOAT color buffer not available");
      return;
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    //shadows buffer
    let lightDepthTextureGPU = gl.createTexture();
    let lightDepthTexture = new utils.BufferedTexture(lightDepthTextureGPU);
    let lightColorTextureGPU = gl.createTexture();
    let lightColorTexture = new utils.BufferedTexture(lightColorTextureGPU);


    //light buffer
    let lDepthGPU = gl.createTexture();
    lTextures.lDepth = new utils.BufferedTexture(lDepthGPU);
    let lAlbedoGPU = gl.createTexture();
    lTextures.lAlbedo = new utils.BufferedTexture(lAlbedoGPU);

    //gbuffer
    let gDepthGPU = gl.createTexture();
    gTextures.gDepth = new utils.BufferedTexture(gDepthGPU);
    let gAlbedoGPU = gl.createTexture();
    gTextures.gAlbedo = new utils.BufferedTexture(gAlbedoGPU);
    let gSpecularGPU = gl.createTexture();
    gTextures.gSpecular = new utils.BufferedTexture(gSpecularGPU);
    let gPositionGPU = gl.createTexture();
    gTextures.gPosition = new utils.BufferedTexture(gPositionGPU);
    let gNormalGPU = gl.createTexture();
    gTextures.gNormal = new utils.BufferedTexture(gNormalGPU);

    //generic postprocess
    let pGen1GPU = gl.createTexture();
    pTextures.pGen1 = new utils.BufferedTexture(pGen1GPU);
    let pGen2GPU = gl.createTexture();
    pTextures.pGen2 = new utils.BufferedTexture(pGen2GPU);
    let pGen3GPU = gl.createTexture();
    pTextures.pGen3 = new utils.BufferedTexture(pGen3GPU);

    //cubemap convolution
    let cEnvCubeGPU = gl.createTexture();
    cTextures.cEnvCube = new utils.BufferedCubemap(cEnvCubeGPU);
    let cIrradianceGPU = gl.createTexture();
    cTextures.cIrradiance = new utils.BufferedCubemap(cIrradianceGPU);

    //shadow buffer

    gl.bindTexture(gl.TEXTURE_2D, lightDepthTextureGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, lightDepthTextureSize, lightDepthTextureSize);

    // gl.bindTexture(gl.TEXTURE_2D, lightColorTextureGPU);
    // gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, lightDepthTextureSize, lightDepthTextureSize);

    FBOs.lightDepthFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.lightDepthFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, lightDepthTextureGPU, 0);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightColorTextureGPU, 0);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    //gbuffer

    gl.bindTexture(gl.TEXTURE_2D, gDepthGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, screenWidth, screenHeight);

    gl.bindTexture(gl.TEXTURE_2D, gPositionGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    gl.bindTexture(gl.TEXTURE_2D, gNormalGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    gl.bindTexture(gl.TEXTURE_2D, gAlbedoGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    gl.bindTexture(gl.TEXTURE_2D, gSpecularGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    gl.bindTexture(gl.TEXTURE_2D, null);

    FBOs.gBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.gBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, gDepthGPU, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gPositionGPU, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, gNormalGPU, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, gAlbedoGPU, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, gSpecularGPU, 0);

    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);

    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }


    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    //lBuffer

    gl.bindTexture(gl.TEXTURE_2D, lDepthGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, screenWidth, screenHeight);

    gl.bindTexture(gl.TEXTURE_2D, lAlbedoGPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    FBOs.lBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.lBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, lDepthGPU, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lAlbedoGPU, 0);

    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }

    //pBuffer1

    gl.bindTexture(gl.TEXTURE_2D, pGen1GPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    FBOs.pBuffer1 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.pBuffer1);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pGen1GPU, 0);

    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }

    //pBuffer2

    gl.bindTexture(gl.TEXTURE_2D, pGen2GPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    FBOs.pBuffer2 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.pBuffer2);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pGen2GPU, 0);

    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }

    //pBuffer3

    gl.bindTexture(gl.TEXTURE_2D, pGen3GPU);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, screenWidth, screenHeight);

    FBOs.pBuffer3 = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.pBuffer3);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pGen3GPU, 0);

    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }

    //cBuffer

    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cEnvCubeGPU);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA16F, 512, 512, 0, gl.RGBA, gl.FLOAT, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cIrradianceGPU);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA16F, 32, 32, 0, gl.RGBA, gl.FLOAT, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    FBOs.cBuffer = gl.createFramebuffer();
    FBOs.cRBuffer = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, FBOs.cBuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, FBOs.cRBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 512, 512);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, FBOs.cRBuffer);

    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE) {
      console.log('fb status: ' + status.toString(16));
      return;
    }

    return [FBOs, gTextures, lTextures, pTextures, cTextures, lightDepthTexture, lightColorTexture];
  }

  bindGBuffer(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.gBuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  bindLBufferForLights(gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.lBuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  prepForForwardPass(gl) {
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.FBOs.gBuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.FBOs.lBuffer);
    gl.blitFramebuffer(0, 0, gl.canvas.width, gl.canvas.height, 0, 0, gl.canvas.width, gl.canvas.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.lBuffer);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }
}