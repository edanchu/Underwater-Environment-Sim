import { tiny, defs } from './examples/common.js';
import { Quaternion, quat } from './Quaternion.js';
import { utils } from './utils.js';
import { shaders } from './shaders.js';
import { Shape_From_File } from './examples/obj-file-demo.js';

const { vec3, vec4, color, Mat4, Shape, Shader, Texture, Component } = tiny;

export class Test extends Component {
  init() {
    this.shapes = {};
    const planeSize = 2;
    this.shapes.surfacePlane = new utils.TriangleStripPlane(planeSize, planeSize, vec3(0, 10, 0), 5);
    this.shapes.ball = new defs.Subdivision_Sphere(6);
    this.shapes.lightVolume = new defs.Subdivision_Sphere(4);
    this.shapes.quad = new utils.ScreenQuad(true);
    this.shapes.cube = new defs.Cube();
    this.shapes.orca = new defs.Shape_From_File("assets/meshes/orca.obj");
    this.shapes.plane = new utils.TriangleStripPlane(2, 2, vec3(0, 0, 0), 1);

    this.FBOs = {};
    this.gTextures = {};
    this.lTextures = {};
    this.pTextures = {};
    this.lightDepthTexture = null;

    this.materials = {};
    this.materials.plastic = { shader: new defs.Phong_Shader(), ambient: .2, diffusivity: 1, specularity: .5, color: vec4(0.9, 0.5, 0.9, 1.0) };

    this.materials.geometryMaterial = { shader: new shaders.GeometryShader(), color: vec4(0.9, 0.5, 0.9, 1.0), specularColor: vec4(0.1, 1, 0.03, 0.5) };
    this.materials.lightingMaterial = { shader: new shaders.PointLightShader(), gTextures: () => this.gTextures, index: null };
    this.materials.directionalLightingMaterial = { shader: new shaders.DirectionalLightShader(), gTextures: () => this.gTextures, index: null };
    this.materials.ambientMaterial = { shader: new shaders.AmbientLightShader(), gTextures: () => this.gTextures, cTextures: () => this.cTextures };
    this.materials.brightCopyMat = { shader: new shaders.CopyBright(), lTextures: () => this.lTextures, threshold: 1.0 };
    this.materials.copyMat = { shader: new shaders.CopyToDefaultFB(), basic: () => this.lTextures.lAlbedo, post: () => this.pTextures.pGen2, exposure: 1.0 };
    this.materials.blurMat = { shader: new shaders.GBlur(), from: () => this.pTextures.gBright, horizontal: false };

    this.materials.brick = { shader: new shaders.GeometryShaderTextured(), texAlbedo: new Texture("assets/textures/brick/red_bricks_04_diff_2k.jpg"), texARM: new Texture("assets/textures/brick/red_bricks_04_arm_2k.jpg"), texNormal: new Texture("assets/textures/brick/red_bricks_04_nor_gl_2k.png") }
    this.materials.marble = { shader: new shaders.GeometryShaderTextured(), texAlbedo: new Texture("assets/textures/marble/BlackMarble_DIF.png"), texRoughness: new Texture("assets/textures/marble/BlackMarble_RGH.png"), texAO: new Texture("assets/textures/marble/BlackMarble_AO.png"), texNormal: new Texture("assets/textures/marble/BlackMarble_NRM.png"), texMetalness: new Texture("assets/textures/marble/BlackMarble_MTL.png") }
    this.materials.orca = { shader: new shaders.GeometryShaderTexturedMinimal(), texAlbedo: new Texture("assets/meshes/Orca_WhiteDetail.png"), roughness: 0.8, metallic: 0.3, ambient: 0.3 }

    this.uniforms.pointLights = [new utils.Light(vec4(0, 4, 15, 1.0), color(0, 0.5, 1, 1), 50, 1)]//, new utils.Light(vec4(0, 0, -13, 1.0), color(1, 1, 1, 1), 3, 1)];
    this.uniforms.directionalLights = [new utils.Light(vec4(5, 35, 5, 1.0), color(1, 1, 1, 1)/*color(0.39, 0.37, 0.25, 1)*/, 15.0, 1)];

    this.HDRI = new utils.HDRTexture('/assets/textures/maps/hdr.hdr');
  }

  render_animation(context) {
    const gl = context.context;
    if (this.HDRI.ready != true) return;

    if (!context.controls /*checks if first animated frame*/) {
      let [_FBOs, _gTextures, _lTextures, _pTextures, _cTextures, _lightDepthTexture] = utils.framebufferInit(gl, 2048, gl.canvas.width, gl.canvas.height);
      this.FBOs = _FBOs, this.gTextures = _gTextures, this.lTextures = _lTextures, this.pTextures = _pTextures, this.cTextures = _cTextures, this.lightDepthTexture = _lightDepthTexture;

      this.animated_children.push(context.controls = new utils.CustomMovementControls({ uniforms: this.uniforms }));
      context.controls.add_mouse_controls(context.canvas);
      Shader.assign_camera(Mat4.look_at(vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0)), this.uniforms);

      utils.convolveCubemaps(context, this.FBOs.cBuffer, this.cTextures, this.shapes.cube, this.HDRI);

      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.enable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }

    this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 0.2, 1000);

    const t = this.t = this.uniforms.animation_time / 1000;

    this.render(context);
  }

  render(context) {
    const gl = context.context;
    utils.bindGBuffer(gl, this.FBOs.gBuffer);


    //deferred geometry
    this.shapes.ball.draw(context, this.uniforms, Mat4.identity().times(Mat4.translation(0, 5, 0)).times(Mat4.scale(1, 1, 1)), { ...this.materials.geometryMaterial, specularColor: vec4(document.getElementById("sld1").value, this.materials.geometryMaterial.specularColor[1], this.materials.geometryMaterial.specularColor[2], document.getElementById("sld2").value) });
    // this.shapes.cube.draw(context, this.uniforms, Mat4.identity().times(Mat4.translation(0, 4, 0)).times(Mat4.scale(2, 2, 2)), this.materials.brick);
    this.shapes.orca.draw(context, this.uniforms, Mat4.identity(), { ...this.materials.orca });
    // this.shapes.plane.draw(context, this.uniforms, Mat4.translation(-50, -5, -50).times(Mat4.scale(100, 1, 100)), { ...this.materials.geometryMaterial, color: vec4(1, 1, 1, 1.0), specularColor: vec4(0.1, 1, 0.03, 1) }, "TRIANGLE_STRIP")

    //lights
    utils.bindLBufferForLights(gl, this.FBOs.lBuffer);

    this.uniforms.pointLights.map((x, i) => this.shapes.lightVolume.draw(context, this.uniforms, Mat4.translation(x.position[0], x.position[1], x.position[2]).times(Mat4.scale(x.radius, x.radius, x.radius)), { ...this.materials.lightingMaterial, index: i }));
    this.uniforms.directionalLights.map((x, i) => this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), { ...this.materials.directionalLightingMaterial, index: i }, "TRIANGLE_STRIP"));
    this.shapes.quad.draw(context, this.uniforms, Mat4.identity(), this.materials.ambientMaterial, "TRIANGLE_STRIP");

    //forward pass
    utils.prepForForwardPass(gl, this.FBOs.lBuffer, this.FBOs.gBuffer);

    this.uniforms.pointLights.map((x) => this.shapes.ball.draw(context, this.uniforms, Mat4.translation(x.position[0], x.position[1], x.position[2]), { ...this.materials.plastic, color: color(x.color[0] / x.lightMax, x.color[1] / x.lightMax, x.color[2] / x.lightMax, 1.0), ambient: 1, specular: 0, diffuse: 0 }), "LINE_STRIP")
    this.shapes.ball.draw(context, this.uniforms, Mat4.scale(500, 500, 500), { ...this.materials.plastic, color: color(120 / 255 / 5, 178 / 255 / 5, 196 / 255 / 5, 1.0), ambient: 1.0, diffusivity: 0.0, specularity: 0.0 },)

    //postprocess
    utils.bloom(12, context, this.shapes.quad, this.materials.blurMat, this.materials.brightCopyMat, this.FBOs, this.pTextures);

    //copy to screen
    utils.drawToScreen(context, this.shapes.quad, { ...this.materials.copyMat, exposure: 1.0 });
  }
}