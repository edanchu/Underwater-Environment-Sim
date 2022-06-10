import { tiny, defs } from './examples/common.js';
import { utils } from './utils.js';
import { shaders } from './shaders.js';
import { Shape_From_File } from './examples/obj-file-demo.js';
import { objects } from './objects.js';
import { WaterSim } from './watersim.js';

const { vec3, vec4, color, Mat4, Shape, Shader, Texture, Component } = tiny;

export class Test extends Component {
  init() {

    this.waterPlaneTransf = Mat4.translation(0, 20, 0).times(Mat4.scale(300, 70, 300));
    this.waterPlaneTransfInv = Mat4.scale(1 / 300, 1 / 70, 1 / 300).times(Mat4.translation(0, -20, 0));

    this.createShapes();
    this.createTextures();
    this.createMaterials();
    this.createSceneObjects();

    this.FBOs = {};
    this.gTextures = {};
    this.lTextures = {};
    this.pTextures = {};
    this.lightDepthTexture = null;

    this.cubemapsLoaded = false;
    this.paused = false;

    this.uniforms.pointLights = []// [new utils.Light(vec4(0, 4, 15, 1.0), color(0, 0.5, 1, 1), 50, 1)], new utils.Light(vec4(0, 0, -13, 1.0), color(1, 1, 1, 1), 3, 1)];
    this.uniforms.directionalLights = [new utils.Light(vec4(5, 35, 5, 0.0), color(0.944, 0.984, 0.991, 1), 3.0, 1)];
  }

  init_context(context) {
    const gl = context.context;

    // Construct the water sim:
    this.waterSim = new WaterSim(gl, 2048, 2048);
    this.waterShader = new shaders.WaterSurfaceShader(); //shaders.WaterMeshShader();

    this.waterMaterial = {
      shader: this.waterShader,
      texture: null, // will be set later
      lightPosition: vec3(2, 2, 2),
    };

    // for (var i = 0; i < 20; i++) {
    //   this.waterSim.drop(gl, Math.random() * 2 - 1, Math.random() * 2 - 1, 0.2, (i & 1) ? 0.05 : -0.05);
    // }

    this.whenToDistort = 0;
  }

  render_animation(context) {
    const gl = context.context;
    if (this.textures.HDRI.ready != true) return;

    if (!context.controls /*checks if first animated frame*/) {
      this.firstTimeSetup(context);
    }

    if (!this.cubemapsLoaded) {
      if (this.createCubemap(gl)) {
        this.cubemapsLoaded = true;
      }
    }

    const t = this.t = this.uniforms.animation_time / 1000;
    const dt = this.dt = this.uniforms.animation_delta_time / 1000;

    if (!this.paused) {

      const fixedTimeStep = 0.001;
      for (let i = 0; i < dt; i += fixedTimeStep) {
        this.sceneObjects.map((x) => x.fixedUpdate(this.sceneObjects, this.uniforms, fixedTimeStep));
      }
      this.sceneObjects.map((x) => x.update(this.sceneObjects, this.uniforms, dt));
    }
    else {
      this.uniforms.animation_time -= this.uniforms.animation_delta_time;
    }

    this.render(context);
  }

  render(context) {
    const gl = context.context;

    let ray_org = context.controls.pos;
    let ray_dir = context.controls.towards;

    let local_ray_org = this.waterPlaneTransfInv.times(vec4(...ray_org, 1.0)).to3();
    let local_ray_dir = this.waterPlaneTransfInv.times(vec4(...ray_dir, 0.0)).to3();

    const ray_t = -local_ray_org[1] / local_ray_dir[1];
    const plane_point = local_ray_org.plus(local_ray_dir.times(ray_t));

    const world_plane_point = this.waterPlaneTransf.times(vec4(...plane_point, 1.0)).to3();

    // Step the water simulation:
    for (let i = 0; i < 2; i++) {
      this.waterSim.step(gl);
      this.waterSim.step(gl);
    }
    this.waterSim.normals(gl);

    // Get the water particle texture:
    this.materials.water.waterParticles = this.waterSim.particleTexture();
    this.materials.water.lightPosition = vec3(100, -20, 100);

    this.whenToDistort += 1;

    if (context.controls.feed) {
      console.log(plane_point.to_string());
      this.waterSim.drop(gl, 0, 0, 0.1, 0.01);

      const transform = Mat4.translation(...world_plane_point).times(Mat4.scale(0.2, 0.4, 0.2));
      this.sceneObjects.push(new utils.SceneObject(this.shapes.cube, { shader: new shaders.GeometryShader(), color: vec4(1, 1, 0, 1.0), specularColor: vec4(0.8, 1, 0.03, 0.5) }, transform, "bait"));

      context.controls.feed = false;
    }

    // if (this.whenToDistort % 256 === 0) {
    //   for (var i = 0; i < 20; i++) {
    //     this.waterSim.drop(gl, Math.random() * 2 - 1, Math.random() * 2 - 1, 0.1, (i & 1) ? 0.03 : -0.03);
    //   }
    // }

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

    //postprocess
    this.depthFogPass(context);
    this.volumePass(context);
    this.bloom(3, context);

    // //copy to screen
    this.drawToScreen(context);
  }

  createSceneObjects() {
    this.sceneObjects = [];
    //this.sceneObjects.push(new objects.WaterPlane(this.shapes.plane, this.materials.water, Mat4.translation(0, 20, 0), "water", "forward", "TRIANGLE_STRIP", false));
    this.sceneObjects.push(new objects.WaterPlane(this.shapes.waterPlane, this.materials.water, this.waterPlaneTransf, "water", "forward", "TRIANGLES", false));
    this.sceneObjects.push(new utils.SceneObject(this.shapes.ball, { ...this.materials.plastic, color: color(.09 / 2, 0.195 / 2, 0.33 / 2, 1.0), ambient: 1.0, diffusivity: 0.0, specularity: 0.0 }, Mat4.scale(500, 500, 500), "skybox", "forward"));
    this.sceneObjects.push(new utils.SceneObject(this.shapes.cube, this.materials.sand, Mat4.translation(0, -85, 0).times(Mat4.scale(3000, 0.1, 3000)), "ground", "deferred", "TRIANGLE_STRIP", false));

    this.sceneBounds = [[-125, 125], [-75, 25], [-125, 125]];

    const trout = new objects.trout(this.shapes.trout, this.materials.trout, Mat4.scale(1, 1, 1.2), "trout", "deferred", "TRIANGLES", true, this.materials.fishShadow);
    const trout2 = new objects.trout(this.shapes.trout, this.materials.trout2, Mat4.scale(1, 1, 1.2), "trout", "deferred", "TRIANGLES", true, this.materials.fishShadow);
    const trout3 = new objects.trout(this.shapes.trout, this.materials.trout3, Mat4.scale(1, 1, 1.2), "trout", "deferred", "TRIANGLES", true, this.materials.fishShadow);
    const trout4 = new objects.trout(this.shapes.trout, this.materials.trout4, Mat4.scale(1, 1, 1.2), "trout", "deferred", "TRIANGLES", true, this.materials.fishShadow);
    this.sceneObjects.push(new objects.boidsController(trout, "boids1", 5, 35, vec3(0, 0, 0), this.sceneBounds));
    this.sceneObjects.push(new objects.boidsController(trout2, "boids2", 5, 35, vec3(0, 0, 0), this.sceneBounds));
    this.sceneObjects.push(new objects.boidsController(trout3, "boids3", 5, 35, vec3(0, 0, 0), this.sceneBounds));
    this.sceneObjects.push(new objects.boidsController(trout4, "boids4", 5, 35, vec3(0, 0, 0), this.sceneBounds));

    const shark = new utils.SceneObject(this.shapes.shark, this.materials.shark, Mat4.scale(5, 5, 5), "shark", "deferred", "TRIANGLES", true, this.materials.sharkShadow);
    this.sceneObjects.push(new objects.predator(shark, "shark1", Mat4.translation((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 50 - 30, (Math.random() - 0.5) * 120), this.sceneBounds));
    this.sceneObjects.push(new objects.predator(shark, "shark2", Mat4.translation((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 50 - 30, (Math.random() - 0.5) * 120), this.sceneBounds));


    // this.sceneObjects.push(new objects.kelpController("kelp", 20, this.sceneBounds, this.materials.kelp, this.materials.basicShadow, 30));
    // this.sceneObjects.push(new objects.kelpController("kelp", 20, this.sceneBounds, this.materials.kelp, this.materials.basicShadow, 150));


    const pkelp = new utils.SceneObject(this.shapes.kelp, this.materials.pkelp, Mat4.translation(0, -40, 0).times(Mat4.scale(10, 25, 10)), "kelp1", "deferred", "TRIANGLES", true, this.materials.pkelpShadow);
    this.sceneObjects.push(new objects.instancedKelpController(pkelp, "pkelp", 1650));

    const pkelp2 = new utils.SceneObject(this.shapes.kelp2, this.materials.pkelp2, Mat4.translation(0, -83.6, 0).times(Mat4.scale(1, 3, 1)), "kelp2", "deferred", "TRIANGLES", true, this.materials.pkelpShadow2);
    this.sceneObjects.push(new objects.instancedKelpController(pkelp2, "pkelp", 200));

    // const coral = new utils.SceneObject(this.shapes.coral, this.materials.coral, Mat4.translation(0, -82.6, 0).times(Mat4.scale(1, 1, 1)), "coral", "deferred", "TRIANGLES", true, this.materials.pkelpShadow);
    // this.sceneObjects.push(new objects.instancedKelpController(coral, "coral", 1000));

    const tubecoral = new utils.SceneObject(this.shapes.tubecoral, this.materials.tubecoral, Mat4.translation(0, -83, 0).times(Mat4.scale(1.3, 1.8, 1.3)), "coral", "deferred", "TRIANGLES", true, this.materials.tubecoralshadow);
    this.sceneObjects.push(new objects.instancedKelpController(tubecoral, "tubecoral", 200));

    this.spawnCrabs();
  }

  createCubemap(gl) {
    if (!(this.cubemapTextures.xneg.ready && this.cubemapTextures.xpos.ready && this.cubemapTextures.yneg.ready
      && this.cubemapTextures.ypos.ready && this.cubemapTextures.zneg.ready && this.cubemapTextures.zpos.ready)) {
      return false;
    }

    let xneg_org = this.cubemapTextures.xneg;
    let xneg_new = document.getElementById("xneg");

    this.cubemap = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubemap);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cubemapTextures.xneg.image);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cubemapTextures.xpos.image);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cubemapTextures.yneg.image); // yneg
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cubemapTextures.ypos.image);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cubemapTextures.zneg.image);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cubemapTextures.zpos.image);

    return true;
  }

  createShapes() {
    this.shapes = {};
    this.planeSize = 300;

    this.shapes.ball = new defs.Subdivision_Sphere(6);
    this.shapes.lightVolume = new defs.Subdivision_Sphere(4);
    this.shapes.quad = new utils.ScreenQuad(true);
    this.shapes.cube = new defs.Cube();

    this.shapes.trout = new defs.Shape_From_File('assets/meshes/trout/trout.obj');
    this.shapes.shark = new defs.Shape_From_File('assets/meshes/shark/shark.obj');
    this.shapes.plane = new utils.TriangleStripPlane(this.planeSize, this.planeSize, vec3(0, 0, 0), 1);
    this.shapes.waterPlane = new WaterPlane2(200, 200);

    const crab1 = new defs.Shape_From_File('assets/meshes/crab/crab1.obj');
    const crab2 = new defs.Shape_From_File('assets/meshes/crab/crab2.obj');
    this.shapes.crab = new utils.BlendShape(crab1, crab2);

    this.shapes.kelp = new defs.Shape_From_File('assets/meshes/kelp/kelp.obj');
    this.shapes.kelp2 = new defs.Shape_From_File('assets/meshes/kelp/kelp2.obj');

    this.shapes.coral = new defs.Shape_From_File('assets/meshes/coral/coralsmall.obj');
    this.shapes.tubecoral = new defs.Shape_From_File('assets/meshes/coral/tube.obj');
  }

  createMaterials() {
    this.materials = {};
    this.materials.plastic = { shader: new defs.Phong_Shader(), ambient: .2, diffusivity: 1, specularity: .5, color: vec4(0.9, 0.5, 0.9, 1.0) };

    this.materials.geometryMaterial = { shader: new shaders.GeometryShader(), color: vec4(0.5, 0.5, 0.5, 1.0), specularColor: vec4(0.8, 1, 0.03, 0.5) };
    this.materials.directionalLightingMaterial = { shader: new shaders.DirectionalLightShader(), caustics: this.textures.caustic, gTextures: () => this.gTextures, index: null, lightDepthTexture: () => this.lightDepthTexture, sunView: () => this.sunView, sunProj: () => this.sunProj };
    this.materials.ambientMaterial = { shader: new shaders.AmbientLightShader(), gTextures: () => this.gTextures, cTextures: () => this.cTextures };
    this.materials.brightCopyMat = { shader: new shaders.CopyBright(), lTextures: () => this.lTextures, threshold: 1.0 };
    this.materials.copyMat = { shader: new shaders.CopyToDefaultFB(), exposure: 3.2, basic: () => this.pTextures.pGen3, post: () => this.pTextures.pGen1, depth: () => this.lTextures.lDepth };
    this.materials.blurMat = { shader: new shaders.GBlur(), from: () => this.pTextures.gBright, horizontal: false };
    this.materials.volumeMat = { shader: new shaders.VolumetricShader(), pGen2: () => this.pTextures.pGen2, lightDepthTexture: () => this.lightDepthTexture, sunViewOrig: () => this.sunViewOrig, sunView: () => this.sunView, sunProj: () => this.sunProj, lTextures: () => this.lTextures, caustics: this.textures.caustic };
    this.materials.depthFogMat = { shader: new shaders.DepthFogShader(), lTextures: () => this.lTextures };

    this.materials.basicShadow = { shader: new shaders.ShadowShaderBase(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.fishShadow = { shader: new shaders.FishShadowShaderInstanced(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.sharkShadow = { shader: new shaders.SharkShadowShader(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.crabShadow = { shader: new shaders.ShadowShaderBlendShape(), proj: () => this.sunProj, view: () => this.sunView };

    this.materials.water = {
      shader: new shaders.WaterSurfaceShader(), //new shaders.WaterMeshShader(),
      color: color(0.3, 0.7, 1, 1),
      gTextures: () => this.gTextures,
      sky: () => this.cubemap,
      waterFlow: new Texture('assets/textures/water/flow_speed_noise.png'),
      waterDerivativeHeight: new Texture('assets/textures/water/water_derivative_height.png'),
      waterParticles: null, // the texture that points to the water particles that we render
      planeSize: this.planeSize,
      specularity: 6.8,
      ambient: 0.3,
      diffusivity: 0.6,
      smoothness: 10
    };

    this.materials.kelp = { shader: new shaders.GeometryShader(), color: vec4(0.1804, 0.5451, 0.3412, 2.0).times(1 / 2), specularColor: vec4(0.8, 1, 0.03, 0.5) };
    this.materials.coral = { shader: new shaders.KelpGeometryShader(), texAlbedo: this.textures.coral, roughness: 0.5, metallic: 0.25, ambient: 0.7 };
    this.materials.tubecoral = { shader: new shaders.TubeCoralShader(), texAlbedo: this.textures.tubecoral, roughness: 0.5, metallic: 0.25, ambient: 0.7 };
    this.materials.pkelp = { shader: new shaders.KelpGeometryShader(), texAlbedo: this.textures.kelp, roughness: 0.9, metallic: 0.25, ambient: 0.7 };
    this.materials.pkelpShadow = { shader: new shaders.ShadowShaderKelp(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.pkelp2 = { shader: new shaders.KelpGeometryShader2(), texAlbedo: this.textures.kelp2, roughness: 0.5, metallic: 0.25, ambient: 0.3 };
    this.materials.pkelpShadow2 = { shader: new shaders.ShadowShaderKelp2(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.tubecoralshadow = { shader: new shaders.TubeCoralShadowShader(), proj: () => this.sunProj, view: () => this.sunView };
    this.materials.sand = { shader: new shaders.SandGeometryShader(), tiling: 45, texAlbedo: this.textures.sand, roughness: 0.8, metallic: 0.35, ambient: 0.15 };
    this.materials.sand2 = { shader: new shaders.SandShader2(), texAlbedo: this.textures.sandD, texARM: this.textures.sandARM, texNormal: this.textures.sandN, textureScale: 70.0, ambientScale: 1.0, texGamma: 3.2, texAlbedo2: this.textures.sandDg, texARM2: this.textures.sandARMg, texNormal2: this.textures.sandNg, textureScale2: 110.0 };
    this.materials.sand3 = { shader: new shaders.GeometryShaderTextured(), texAlbedo: this.textures.sandD, texARM: this.textures.sandARM, texNormal: this.textures.sandN, textureScale: 110.0, ambientScale: 6.5, texGamma: 2.2 };
    this.materials.trout = { shader: new shaders.FishGeometryShaderInstanced(), texAlbedo: this.textures.fish1, roughness: 0.8, metallic: 0.35, ambient: 1.0 };
    this.materials.trout2 = { shader: new shaders.FishGeometryShaderInstanced(), texAlbedo: this.textures.fish2, roughness: 0.8, metallic: 0.35, ambient: 1.0 };
    this.materials.trout3 = { shader: new shaders.FishGeometryShaderInstanced(), texAlbedo: this.textures.fish3, roughness: 0.8, metallic: 0.35, ambient: 1.0 };
    this.materials.trout4 = { shader: new shaders.FishGeometryShaderInstanced(), texAlbedo: this.textures.fish4, roughness: 0.8, metallic: 0.35, ambient: 1.0 };
    this.materials.shark = { shader: new shaders.SharkGeometryShader(), texAlbedo: this.textures.shark, roughness: 0.8, metallic: 0.35, ambient: 2.0 };
    this.materials.crab = { shader: new shaders.GeometryShaderTexturedMinimalBlendShape(), t: 1.0, texAlbedo: this.textures.crab, roughness: 0.9, metallic: 0.0, ambient: 1.0 };
  }

  createTextures() {
    this.textures = {};
    this.textures.HDRI = new utils.HDRTexture('/assets/textures/maps/hdr.hdr');
    this.textures.caustic = new Texture('/assets/textures/misc/caust_001.png');
    this.textures.fish1 = new Texture('assets/meshes/trout/troutAlbedo.png');
    this.textures.fish2 = new Texture('assets/meshes/trout/trout2.png');
    this.textures.fish3 = new Texture('assets/meshes/trout/trout3.png');
    this.textures.fish4 = new Texture('assets/meshes/trout/trout4.png');

    // Cube map texture:
    this.cubemapTextures = {
      xneg: new Texture("assets/textures/water_cubemap/xneg.jpg"),
      xpos: new Texture("assets/textures/water_cubemap/xpos.jpg"),
      yneg: new Texture("assets/textures/water_cubemap/yneg.jpg"),
      ypos: new Texture("assets/textures/water_cubemap/ypos.jpg"),
      zneg: new Texture("assets/textures/water_cubemap/zpos.jpg"),
      zpos: new Texture("assets/textures/water_cubemap/zneg.jpg"),
    };

    this.textures.crab = new Texture('assets/meshes/crab/crab_albedo2.png');
    this.textures.shark = new Texture('/assets/meshes/shark/GreatWhiteShark.png');
    this.textures.kelp = new Texture('/assets/meshes/kelp/kelpAlbedo.jpg');
    this.textures.kelp2 = new Texture('/assets/meshes/kelp/kelp2Albedo.png');
    this.textures.sand = new Texture('/assets/textures/sand/beach_sand.png');
    this.textures.sandD = new Texture('/assets/textures/sand/aerial_diff.png');
    this.textures.sandARM = new Texture('/assets/textures/sand/aerial_arm.png');
    this.textures.sandN = new Texture('/assets/textures/sand/aerial_norm.png');
    this.textures.sandDg = new Texture('/assets/textures/sand/sand_g_d.png');
    this.textures.sandARMg = new Texture('/assets/textures/sand/sand_g_arm.png');
    this.textures.sandNg = new Texture('/assets/textures/sand/sand_g_n.png');
    this.textures.coral = new Texture('/assets/meshes/coral/coralsmall.png');
    this.textures.tubecoral = new Texture('/assets/meshes/coral/tubetex.png');
  }

  firstTimeSetup(context) {
    const gl = context.context;

    let [_FBOs, _gTextures, _lTextures, _pTextures, _cTextures, _lightDepthTexture, _lightColorTexture] = this.framebufferInit(gl, 4096, gl.canvas.width, gl.canvas.height);
    this.FBOs = _FBOs, this.gTextures = _gTextures, this.lTextures = _lTextures, this.pTextures = _pTextures, this.cTextures = _cTextures, this.lightDepthTexture = _lightDepthTexture, this.lightColorTexture = _lightColorTexture;

    this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 0.5, 1000);

    this.animated_children.push(context.controls = new utils.CustomMovementControls({ uniforms: this.uniforms }));
    context.controls.add_mouse_controls(context.canvas);
    Shader.assign_camera(Mat4.look_at(vec3(100, 0, 100), vec3(0, 0, 0), vec3(0, 1, 0)), this.uniforms);

    this.convolveCubemaps(context, this.FBOs.cBuffer, this.cTextures, this.shapes.cube, this.textures.HDRI);

    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  spawnCrabs() {
    const crab = new utils.SceneObject(this.shapes.crab, this.materials.crab, Mat4.scale(1, 1, 1), "crab", "deferred", "TRIANGLES", true, this.materials.crabShadow);
    let crab_x_saturation_factor = 1;
    let crab_z_saturation_factor = 1;
    let crab_orientation_factor = 0;
    this.crab_num = 10;
    for (this.crab_index = 0; this.crab_index < this.crab_num; this.crab_index++) {

      if (Math.random() > 0.5) {
        crab_x_saturation_factor = -1;
      }
      else {
        crab_x_saturation_factor = 1;
      }
      if (Math.random() > 0.5) {
        crab_z_saturation_factor = -1;
      }
      else {
        crab_z_saturation_factor = 1;
      }
      if (Math.random() > 0.5) {
        crab_x_saturation_factor = -1;
      }
      else {
        crab_x_saturation_factor = 1;
      }
      if (Math.random() > 0.5) {
        crab_orientation_factor = 1;
      }
      else {
        crab_orientation_factor = 0;
      }

      this.sceneObjects.push(new objects.crab(crab, "crab_" + this.crab_index, Mat4.translation((Math.random()) * 120 * crab_x_saturation_factor, -84.4, (Math.random()) * 120 * crab_z_saturation_factor).times(Mat4.rotation(Math.PI * crab_orientation_factor, 0, 1, 0)), this.sceneBounds));

    }
  }

  //engine stuff

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
    gl.viewport(0, 0, 4096, 4096);

    this.uniforms.directionalLights[0].updatePosition(vec4(this.uniforms.camera_transform[0][3], 35, this.uniforms.camera_transform[2][3] - 150, 0));

    if (this.sunViewOrig == undefined) {
      this.sunViewOrig = Mat4.look_at(this.uniforms.directionalLights[0].position.copy(), this.uniforms.directionalLights[0].position.to3().minus(this.uniforms.directionalLights[0].direction.to3()), vec3(0, 1, 0));
      this.sunProj = Mat4.orthographic(-400, 250, -400, 250, 0.5, 150);
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

    this.shapes.quad.draw(context, this.uniforms, null, this.materials.copyMat, "TRIANGLE_STRIP");
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

  render_controls() {
    this.key_triggered_button("Random waves (need to hold down)", ["l"], () => {
      this.waterSim.drop(this.context, clamp(-1, randn_bm(), 1), clamp(-1, randn_bm(), 1), 0.1, (parseInt(Math.random() * 20) & 1) ? -0.03 : 0.03);
    }, "green");
    this.key_triggered_button("Pause movement", ["p"], () => this.paused = !this.paused);
    this.new_line();
  }

}

function randn_bm() {
  var u = 0, v = 0;
  while (u === 0) u = Math.random(); //Converting [0,1) to (0,1)
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function clamp(x, y, z) {
  return Math.min(Math.max(x, y), z);
}

class WaterPlane2 extends Shape {
  // Constructs the shape, using detailx and detaily to specify a resolution:
  constructor(detailx, detaily) {
    super("position");

    this.arrays.position = [];
    this.indices = [];

    for (let y = 0; y <= detaily; y++) {
      const t = y / detaily;
      for (let x = 0; x <= detailx; x++) {
        const s = x / detailx;
        this.arrays.position.push(vec3(2 * s - 1, 2 * t - 1, 0));

        if (x < detailx && y < detaily) {
          const i = x + y * (detailx + 1);
          this.indices.push(i, i + 1, i + detailx + 1);
          this.indices.push(i + detailx + 1, i + 1, i + detailx + 2);
        }
      }
    }
  }
}