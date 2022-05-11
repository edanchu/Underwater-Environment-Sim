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

    this.uniforms.pointLights = [new utils.Light(vec4(0, 4, 15, 1.0), color(0, 0.5, 1, 1), 50, 1)]//, new utils.Light(vec4(0, 0, -13, 1.0), color(1, 1, 1, 1), 3, 1)];
    this.uniforms.directionalLights = [new utils.Light(vec4(5, 25, 5, 0.0), color(1, 1, 1, 1)/*color(0.39, 0.37, 0.25, 1)*/, 7.0, 1)];
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

    utils.bindGBuffer(gl, this.FBOs.gBuffer);

    //deferred geometry
    this.sceneObjects.map((x) => { if (x.pass == "deferred") x.draw(context, this.uniforms) });

    //lights
    utils.bindLBufferForLights(gl, this.FBOs.lBuffer);

    this.uniforms.pointLights.map((x, i) => this.shapes.lightVolume.draw(context, this.uniforms, Mat4.translation(x.position[0], x.position[1], x.position[2]).times(Mat4.scale(x.radius, x.radius, x.radius)), { ...this.materials.lightingMaterial, index: i }));
    this.uniforms.directionalLights.map((x, i) => this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), { ...this.materials.directionalLightingMaterial, index: i }, "TRIANGLE_STRIP"));
    this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), this.materials.ambientMaterial, "TRIANGLE_STRIP");

    //forward pass
    utils.prepForForwardPass(gl, this.FBOs.lBuffer, this.FBOs.gBuffer);
    this.sceneObjects.map((x) => { if (x.pass == "forward") x.draw(context, this.uniforms) });
    this.sceneObjects.map((x) => { if (x.pass == "transparent") x.draw(context, this.uniforms) });

    //postprocess
    utils.bloom(5, context, this.shapes.quad, this.materials.blurMat, this.materials.brightCopyMat, this.FBOs, this.pTextures);

    // //copy to screen
    utils.drawToScreen(context, this.shapes.quad, { ...this.materials.copyMat, exposure: 1.0 });
  }

  createSceneObjects() {
    this.sceneObjects = [];
    // this.sceneObjects.push(new utils.SceneObject(this.shapes.ball, this.materials.geometryMaterial, Mat4.identity(), "testball"));
    this.sceneObjects.push(new objects.WaterPlane(this.shapes.plane, this.materials.water, Mat4.translation(this.uniforms.camera_transform[0][3], 20, this.uniforms.camera_transform[2][3]), "water", "forward", "TRIANGLE_STRIP", false));
    this.sceneObjects.push(new utils.SceneObject(this.shapes.ball, { ...this.materials.plastic, color: color(.09 / 2, 0.195 / 2, 0.33 / 2, 1.0), ambient: 1.0, diffusivity: 0.0, specularity: 0.0 }, Mat4.scale(500, 500, 500), "skybox", "forward"));
    this.sceneObjects.push(new objects.trout(this.shapes.trout, this.materials.trout, Mat4.identity(), "trout", "deferred", "TRIANGLES", true, { ...this.materials.fishShadow, proj: () => this.sunProj, view: () => this.sunView }));
    this.sceneObjects.push(new utils.SceneObject(this.shapes.plane, this.materials.geometryMaterial, Mat4.translation(0, -10, 0), "ground", "deferred", "TRIANGLE_STRIP", true));
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
    this.shapes.plane = new utils.TriangleStripPlane(this.planeSize, this.planeSize, vec3(0, 0, 0), 1);
  }

  createMaterials() {
    this.materials = {};
    this.materials.plastic = { shader: new defs.Phong_Shader(), ambient: .2, diffusivity: 1, specularity: .5, color: vec4(0.9, 0.5, 0.9, 1.0) };

    this.materials.geometryMaterial = { shader: new shaders.GeometryShader(), color: vec4(0.5, 0.5, 0.5, 1.0), specularColor: vec4(0.8, 1, 0.03, 0.5) };
    this.materials.lightingMaterial = { shader: new shaders.PointLightShader(), gTextures: () => this.gTextures, index: null };
    this.materials.directionalLightingMaterial = { shader: new shaders.DirectionalLightShader(), gTextures: () => this.gTextures, index: null, lightDepthTexture: () => this.lightDepthTexture, sunView: () => this.sunView, sunProj: () => this.sunProj };
    this.materials.ambientMaterial = { shader: new shaders.AmbientLightShader(), gTextures: () => this.gTextures, cTextures: () => this.cTextures };
    this.materials.brightCopyMat = { shader: new shaders.CopyBright(), lTextures: () => this.lTextures, threshold: 1.0 };
    this.materials.copyMat = { shader: new shaders.CopyToDefaultFB(), basic: () => this.lTextures.lAlbedo, post: () => this.pTextures.pGen2, exposure: 1.0 };
    this.materials.blurMat = { shader: new shaders.GBlur(), from: () => this.pTextures.gBright, horizontal: false };

    this.materials.basicShadow = { shader: new shaders.ShadowShaderBase() };
    this.materials.fishShadow = { shader: new shaders.FishShadowShader() };

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

    this.materials.brick = { shader: new shaders.GeometryShaderTextured(), texAlbedo: new Texture("assets/textures/brick/red_bricks_04_diff_2k.jpg"), texARM: new Texture("assets/textures/brick/red_bricks_04_arm_2k.jpg"), texNormal: new Texture("assets/textures/brick/red_bricks_04_nor_gl_2k.png") }
    this.materials.marble = { shader: new shaders.GeometryShaderTextured(), texAlbedo: new Texture("assets/textures/marble/BlackMarble_DIF.png"), texRoughness: new Texture("assets/textures/marble/BlackMarble_RGH.png"), texAO: new Texture("assets/textures/marble/BlackMarble_AO.png"), texNormal: new Texture("assets/textures/marble/BlackMarble_NRM.png"), texMetalness: new Texture("assets/textures/marble/BlackMarble_MTL.png") }
    this.materials.trout = { shader: new shaders.FishGeometryShader(), texAlbedo: new Texture('assets/meshes/trout/troutAlbedo.png'), roughness: 0.8, metallic: 0.35, ambient: 2.0 };

  }

  createTextures() {
    this.textures = {};
    this.textures.HDRI = new utils.HDRTexture('/assets/textures/maps/hdr.hdr');
  }

  firstTimeSetup(context) {
    const gl = context.context;
    let [_FBOs, _gTextures, _lTextures, _pTextures, _cTextures, _lightDepthTexture, _lightColorTexture] = utils.framebufferInit(gl, 2048, gl.canvas.width, gl.canvas.height);
    this.FBOs = _FBOs, this.gTextures = _gTextures, this.lTextures = _lTextures, this.pTextures = _pTextures, this.cTextures = _cTextures, this.lightDepthTexture = _lightDepthTexture, this.lightColorTexture = _lightColorTexture;

    this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 0.5, 1000);

    this.animated_children.push(context.controls = new utils.CustomMovementControls({ uniforms: this.uniforms }));
    context.controls.add_mouse_controls(context.canvas);
    Shader.assign_camera(Mat4.look_at(vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0)), this.uniforms);

    utils.convolveCubemaps(context, this.FBOs.cBuffer, this.cTextures, this.shapes.cube, this.textures.HDRI);

    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  drawSunShadows(context) {
    const gl = context.context;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.FBOs.lightDepthFramebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, 2048, 2048);

    if (this.sunView == undefined) {
      this.sunView = Mat4.look_at(this.uniforms.directionalLights[0].position.copy(), vec3(0, 0, 0), vec3(0, 1, 0));
      this.sunProj = Mat4.perspective(Math.PI / 2, 1, 5, 100);
    }

    this.sceneObjects.map((x) => { if (x.pass == "deferred" && x.castShadows == true) x.drawShadow(context, this.uniforms) });
    gl.viewport(0, 0, context.canvas.width, context.canvas.height);
  }
}