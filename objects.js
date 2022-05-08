import { tiny, defs } from './examples/common.js';
import { Quaternion, quat } from './Quaternion.js';
import { utils } from './utils.js';
import { shaders } from './shaders.js';

const { vec3, vec4, color, Mat4, Shape, Shader, Texture, Component } = tiny;

export const objects = {};

objects.WaterPlane = class WaterPlane extends utils.SceneObject {
    draw(context, uniforms) {
        this.shape.draw(context, uniforms, Mat4.translation(uniforms.camera_transform[3][0], 20, uniforms.camera_transform[3][2]), this.material, this.drawType);
    }
}

objects.trout = class trout extends utils.SceneObject {
    draw(context, uniforms) {
        // this.shape.draw(context, uniforms, Mat4.identity(), { ...this.material, roughness: document.getElementById('sld2').value, metallic: document.getElementById('sld1').value }, this.drawType);
        this.shape.draw(context, uniforms, Mat4.identity(), { ...this.material, roughness: 0.9, metallic: 0.1, ambient: 1 }, this.drawType);
    }
}