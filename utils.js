import { tiny } from './tiny-graphics.js'
import { math } from './tiny-graphics-math.js'
import { Quaternion, quat } from './Quaternion.js';
import { loadHDR, rgbeToFloat } from './hdrpng.js';
import { shaders } from './shaders.js';

const { Vector, Vector3, vec3, Mat4, vec, vec4 } = math;
const { Shape, Component, Material } = tiny;

export const utils = {};

// custom shape class that creates a triangle strip plane with a given length (z wise) and width (x wise) centered around a
// given origin. Each vertex is placed such that there are density number of vertices between each unit distance
// (eg: density 10 means that you'll get 10 vertices between (0,0,0) and (1,0,0))
utils.TriangleStripPlane = class TriangleStripPlane extends Shape {
    constructor(length, width, origin, density) {
        super("position", "normal", "texture_coord");
        this.length = length;
        this.width = width;
        this.density = density;
        let denseWidth = width * density;
        let denseLength = length * density;
        // create vertex positions, normals and texture coords. texture coords go from 0,1 in top left to 1,0 in bottom right and are
        // just interpolated by percentage of the way from 0 -> number of desired vertices
        for (let z = 0; z < denseWidth; z += 1) {
            for (let x = 0; x < denseLength; x += 1) {
                this.arrays.position.push(Vector3.create(x / density - length / 2 + origin[0] + 1, origin[1], z / density - width / 2 + origin[2] + 1));
                this.arrays.texture_coord.push(Vector.create(x / denseLength, 1 - (z / denseWidth)));
                //this.arrays.normal.push(Vector3.create(x/density - length/2 + origin[0] + 1,origin[1],z/density - width/2 + origin[2] + 1));
                this.arrays.normal.push(Vector3.create(0, 1, 0));
            }
        }

        //create the index buffer by connecting points by right hand rule starting by top left, then one under, then one right of the original point and so on
        //in order for the triangle strips to work need to double up on the last index in every row, and the one right after.
        for (let z = 0; z < denseWidth - 1; z++) {
            if (z > 0) this.indices.push(z * denseLength);
            for (let x = 0; x < denseLength; x++) {
                this.indices.push((z * denseLength) + x, ((z + 1) * denseLength) + x);
            }
            if (z < denseWidth - 2) this.indices.push(((z + 2) * denseLength) - 1);
        }
    }
}

utils.CircleMesh = class CircleMesh extends Shape {
    constructor(radius, steps, subdivisions) {
        super("position", "normal", "texture_coord");

        let stepAngle = Math.PI * 2 / subdivisions;
        let stepMagnitude = radius / steps;

        this.arrays.position.push(vec3(0, 0, 0));
        for (let i = 1; i <= steps; i++) {
            for (let j = 0; j < subdivisions; j++) {
                this.arrays.position.push(vec3(stepMagnitude * i * Math.cos(stepAngle * j), 0, stepMagnitude * i * Math.sin(stepAngle * j)));
                this.arrays.normal.push(vec3(0, 1, 0));
            }
        }

        this.indices.push(0, 1, subdivisions);
        for (let i = 0; i < subdivisions - 1; i++) {
            this.indices.push(0, i + 2, i + 1);
        }

        let curr;
        for (let i = 1; i < steps; i++) {
            for (let j = 0; j < subdivisions - 1; j++) {
                curr = i * subdivisions + j + 1;
                this.indices.push(curr - subdivisions, curr + 1, curr, curr - subdivisions, curr - subdivisions + 1, curr + 1);
            }
            this.indices.push(curr + 1 - subdivisions, curr + 2 - subdivisions, curr + 1, curr + 1 - subdivisions, curr + 2 - subdivisions - subdivisions, curr + 2 - subdivisions);
        }
    }
}

utils.ScreenQuad = class ScreenQuad extends Shape {
    constructor(switchOrdering) {
        super("position", "normal");

        this.arrays.position = [vec3(-1, 1, 0), vec3(-1, -1, 0), vec3(1, 1, 0), vec3(1, -1, 0)];
        this.arrays.normal = [vec3(0, 0, 1), vec3(0, 0, 1), vec3(0, 0, 1), vec3(0, 0, 1)];
        this.indices = switchOrdering == true ? [0, 1, 2, 3] : [0, 2, 1, 3];
    }
}

utils.CustomMovementControls = class CustomMovementControls extends Component {
    roll = 0;
    look_around_locked = true;
    thrust = vec3(0, 0, 0);
    pos = vec3(0, 0, 0);
    z_axis = vec3(0, 0, 0);
    radians_per_frame = 1 / 200;
    meters_per_frame = 20;
    speed_multiplier = 1;
    mouse_enabled_canvases = new Set();
    will_take_over_uniforms = true;

    set_recipient(matrix_closure, inverse_closure) {
        this.matrix = matrix_closure;
        this.inverse = inverse_closure;
    }

    reset() {
        this.set_recipient(() => this.uniforms.camera_transform,
            () => this.uniforms.camera_inverse);
    }

    add_mouse_controls(canvas) {
        if (this.mouse_enabled_canvases.has(canvas))
            return;
        this.mouse_enabled_canvases.add(canvas);
        // First, measure mouse steering, for rotating the flyaround camera:
        this.mouse = { "from_center": vec(0, 0) };
        const mouse_position = (e, rect = canvas.getBoundingClientRect()) =>
            vec(e.clientX - (rect.left + rect.right) / 2, e.clientY - (rect.bottom + rect.top) / 2);
        // Set up mouse response.  The last one stops us from reacting if the mouse leaves the canvas:
        document.addEventListener("mouseup", e => { this.mouse.anchor = undefined; });
        canvas.addEventListener("mousedown", e => {
            e.preventDefault();
            this.mouse.anchor = mouse_position(e);
            document.body.requestPointerLock();
            this.look_around_locked = false;
            document.body.ownerDocument.addEventListener('mousemove', this.first_person_flyaround);
        });
        canvas.addEventListener("mousemove", e => {
            e.preventDefault();
            this.mouse.from_center = mouse_position(e);
        });
        canvas.addEventListener("mouseout", e => { if (!this.mouse.anchor) this.mouse.from_center.scale_by(0); });
    }

    render_explanation(document_builder, document_element = document_builder.document_region) { }

    render_controls() {
        this.control_panel.innerHTML += "Click and drag the scene to <br> spin your viewpoint around it.<br>";
        this.key_triggered_button("Up", [" "], () => this.thrust[1] = -1, undefined, () => this.thrust[1] = 0);
        this.key_triggered_button("Forward", ["w"], () => this.thrust[2] = 1, undefined,
            () => this.thrust[2] = 0);
        this.new_line();
        this.key_triggered_button("Left", ["a"], () => this.thrust[0] = 1, undefined, () => this.thrust[0] = 0);
        this.key_triggered_button("Back", ["s"], () => this.thrust[2] = -1, undefined, () => this.thrust[2] = 0);
        this.key_triggered_button("Right", ["d"], () => this.thrust[0] = -1, undefined,
            () => this.thrust[0] = 0);
        this.new_line();
        this.key_triggered_button("Down", ["z"], () => this.thrust[1] = 1, undefined, () => this.thrust[1] = 0);
        this.new_line();
        this.key_triggered_button("free mouse", ["f"], () => {
            this.look_around_locked = true;
            document.body.ownerDocument.exitPointerLock();
            document.body.ownerDocument.removeEventListener('mousemove', this.first_person_flyaround);
        },
            "green");

        this.new_line();
        this.live_string(box => box.textContent = "" + 1 / (this.uniforms.animation_delta_time / 1000));
    }

    first_person_flyaround = (e) => {
        const speed = 1.0;
        const mX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
        const mY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

        let x = Math.asin(- clamp(this.matrix()[1][2], - 1, 1)), y, z;

        if (Math.abs(this.matrix()[1][2]) < 0.9999999) {

            y = Math.atan2(this.matrix()[0][2], this.matrix()[2][2]);
            z = Math.atan2(this.matrix()[1][0], this.matrix()[1][1]);

        } else {

            y = Math.atan2(- this.matrix()[2][0], this.matrix()[0][0]);
            z = 0;

        }

        y -= mX * 0.002 * speed;
        x -= mY * 0.002 * speed;
        x = Math.max(Math.PI / 2 - Math.PI, Math.min(Math.PI / 2 - 0, x));

        const mat = Quaternion.fromEuler(x, y, z).toRotationMatrix();
        this.matrix().set(Mat4.translation(...this.pos).times(mat));
        this.inverse().set(Mat4.inverse(this.matrix()));
    }

    render_animation(context) {
        const m = this.speed_multiplier * this.meters_per_frame,
            r = this.speed_multiplier * this.radians_per_frame,
            dt = this.uniforms.animation_delta_time / 1000;

        if (this.will_take_over_uniforms) {
            this.reset();
            this.will_take_over_uniforms = false;
        }
        // Move in first-person.  Scale the normal camera aiming speed by dt for smoothness:
        this.matrix().post_multiply(Mat4.translation(...this.thrust.times(dt * -m)));
        this.inverse().pre_multiply(Mat4.translation(...this.thrust.times(dt * m)));

        // Log some values:
        this.pos = this.matrix().times(vec4(0, 0, 0, 1)).to3();
        this.z_axis = this.inverse().times(vec4(0, 0, 1, 0));
    }
}

function clamp(x, y, z) {
    return Math.min(Math.max(x, y), z);
}

utils.BufferedTexture = class BufferedTexture {
    // **Texture** wraps a pointer to a new texture image where
    // it is stored in GPU memory, along with a new HTML image object.
    // This class initially copies the image to the GPU buffers,
    // optionally generating mip maps of it and storing them there too.
    constructor(texture_buffer_pointer) {
        if (!this.gpu_instances) this.gpu_instances = new Map();
        Object.assign(this, { texture_buffer_pointer });
        this.ready = true;
        this.texture_buffer_pointer = texture_buffer_pointer;
    }

    copy_onto_graphics_card(context, need_initial_settings = true) {
        // Define what this object should store in each new WebGL Context:
        const initial_gpu_representation = { texture_buffer_pointer: undefined };
        // Our object might need to register to multiple GPU contexts in the case of
        // multiple drawing areas.  If this is a new GPU context for this object,
        // copy the object to the GPU.  Otherwise, this object already has been
        // copied over, so get a pointer to the existing instance.
        const gpu_instance = super.copy_onto_graphics_card(context, initial_gpu_representation);

        if (!gpu_instance.texture_buffer_pointer) gpu_instance.texture_buffer_pointer = this.texture_buffer_pointer;
        return gpu_instance;
    }

    activate(context, texture_unit = 0) {
        // activate(): Selects this Texture in GPU memory so the next shape draws using it.
        // Optionally select a texture unit in case you're using a shader with many samplers.
        // Terminate draw requests until the image file is actually loaded over the network:
        if (!this.ready)
            return;
        //const gpu_instance = super.activate(context);
        context.activeTexture(context["TEXTURE" + texture_unit]);
        context.bindTexture(context.TEXTURE_2D, this.texture_buffer_pointer);
    }
}

utils.BufferedCubemap = class BufferedCubemap {
    // **Texture** wraps a pointer to a new texture image where
    // it is stored in GPU memory, along with a new HTML image object.
    // This class initially copies the image to the GPU buffers,
    // optionally generating mip maps of it and storing them there too.
    constructor(texture_buffer_pointer) {
        if (!this.gpu_instances) this.gpu_instances = new Map();
        Object.assign(this, { texture_buffer_pointer });
        this.ready = true;
        this.texture_buffer_pointer = texture_buffer_pointer;
    }

    copy_onto_graphics_card(context, need_initial_settings = true) {
        // Define what this object should store in each new WebGL Context:
        const initial_gpu_representation = { texture_buffer_pointer: undefined };
        // Our object might need to register to multiple GPU contexts in the case of
        // multiple drawing areas.  If this is a new GPU context for this object,
        // copy the object to the GPU.  Otherwise, this object already has been
        // copied over, so get a pointer to the existing instance.
        const gpu_instance = super.copy_onto_graphics_card(context, initial_gpu_representation);

        if (!gpu_instance.texture_buffer_pointer) gpu_instance.texture_buffer_pointer = this.texture_buffer_pointer;
        return gpu_instance;
    }

    activate(context, texture_unit = 0) {
        // activate(): Selects this Texture in GPU memory so the next shape draws using it.
        // Optionally select a texture unit in case you're using a shader with many samplers.
        // Terminate draw requests until the image file is actually loaded over the network:
        if (!this.ready)
            return;
        //const gpu_instance = super.activate(context);
        context.activeTexture(context["TEXTURE" + texture_unit]);
        context.bindTexture(context.TEXTURE_CUBE_MAP, this.texture_buffer_pointer);
    }
}

utils.Light = class Light {
    constructor(position, color, intensity = 1, isDirectional = false, size = null, updateFunction = () => { }) {
        this.position = position.copy();
        this.direction = position.copy();
        this.isDirectional = isDirectional;
        this.baseColor = color.copy();
        this.color = color.times(intensity);
        this.lightMax = Math.max(this.color[0], Math.max(this.color[1], this.color[2]));
        const constant = 1.0, linear = 0.7, quad = 1.8;
        this.radius = (-linear + Math.sqrt(linear * linear - 4 * quad * (constant - (256.0 / 1.0) * this.lightMax))) / (2 * quad);
        this.attenuation = size == null ? 1 / this.radius : 1 / size;
    }

    updateColor(newColor) {
        this.baseColor = newColor.copy();
        this.color = newColor.times(intensity);
        this.lightMax = Math.max(this.color[0], Math.max(this.color[1], this.color[2]));
        const constant = 1.0, linear = 0.7, quad = 1.8;
        this.radius = (-linear + Math.sqrt(linear * linear - 4 * quad * (constant - (256.0 / 1.0) * this.lightMax))) / (2 * quad);
        this.attenuation = 1 / this.radius;
    }

    updateIntensity(newIntensity) {
        this.intensity = newIntensity;
        this.color = this.baseColor.times(newIntensity);
        this.lightMax = Math.max(this.color[0], Math.max(this.color[1], this.color[2]));
        const constant = 1.0, linear = 0.7, quad = 1.8;
        this.radius = (-linear + Math.sqrt(linear * linear - 4 * quad * (constant - (256.0 / 1.0) * this.lightMax))) / (2 * quad);
        this.attenuation = 1 / this.radius;
    }

    updatePosition(newPos) {
        this.position = newPos.copy();
    }

    updateDirection(newDir) {
        this.direction = newDir;
    }

    update() { };
}

utils.HDRTexture = class HDRTexture {
    constructor(filename) {
        Object.assign(this, { filename });

        if (!this.gpu_instances) this.gpu_instances = new Map();     // Track which GPU contexts this object has
        // copied itself onto.

        this.image = null, this.width = null, this.height = null, this.ready = false;
        loadHDR(filename, (img, width, height) => { this.image = rgbeToFloat(img); this.ready = true; this.height = height; this.width = width; });

    }
    copy_onto_graphics_card(context, need_initial_settings = true) {
        // Define what this object should store in each new WebGL Context:
        const defaults = { texture_buffer_pointer: undefined };

        const existing_instance = this.gpu_instances.get(context);

        // If this Texture was never used on this GPU context before, then prepare new buffer indices for this
        // context.
        const gpu_instance = existing_instance || this.gpu_instances.set(context, defaults).get(context);

        if (!gpu_instance.texture_buffer_pointer) gpu_instance.texture_buffer_pointer = context.createTexture();

        const gl = context;
        gl.bindTexture(gl.TEXTURE_2D, gpu_instance.texture_buffer_pointer);

        if (need_initial_settings) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, this.width, this.height, 0, gl.RGB, gl.FLOAT, this.image);
        return gpu_instance;
    }
    activate(context, texture_unit = 0) {
        if (!this.ready)
            return;          // Terminate draw requests until the image file is actually loaded over the network.
        const gpu_instance = this.gpu_instances.get(context) || this.copy_onto_graphics_card(context);
        context.activeTexture(context["TEXTURE" + texture_unit]);
        context.bindTexture(context.TEXTURE_2D, gpu_instance.texture_buffer_pointer);
    }
}

utils.SceneObject = class SceneObject {
    constructor(shape, material, initTransform, id, pass = "deferred", drawType = "TRIANGLES", castShadows = true, shadowMaterial = null) {
        this.shape = shape;
        this.material = material;
        this.transform = initTransform;
        this.drawType = drawType;
        this.pass = pass;
        this.id = id;
        this.castShadows = castShadows;
        this.shadowMaterial = (shadowMaterial != null) ? shadowMaterial : this.material;
    }

    draw(context, uniforms) {
        this.shape.draw(context, uniforms, this.transform, this.material, this.drawType);
    }

    drawOverrideMaterial(context, uniforms, materialOverride) {
        this.shape.draw(context, uniforms, this.transform, materialOverride, this.drawType);
    }

    drawOverrideTransform(context, uniforms, transformOverride) {
        this.shape.draw(context, uniforms, transformOverride, this.material, this.drawType);
    }

    drawShadow(context, uniforms, materialOverride) {
        this.shape.draw(context, uniforms, this.transform, this.shadowMaterial, this.drawType);
    }

    drawShadowOverrideTransform(context, uniforms, transformOverride) {
        this.shape.draw(context, uniforms, transformOverride, this.shadowMaterial, this.drawType);
    }

    update(sceneObjects, uniforms, dt) { };

    fixedUpdate(sceneObjects, uniforms, dt) { };

}

utils.KelpObject = class KelpObject {
    constructor(shape, material, initTransform, id, pass = "deferred", drawType = "TRIANGLES", castShadows = true, shadowMaterial = null, clusterVal = 0) {
        this.shape = shape;
        this.material = material;
        this.transform = initTransform;
        this.drawType = drawType;
        this.pass = pass;
        this.id = id;
        this.castShadows = castShadows;
        this.shadowMaterial = (shadowMaterial != null) ? shadowMaterial : this.material;
        this.t = 0;
        this.clusterVal = clusterVal;
        console.log(clusterVal);
    }

    draw(context, uniforms) {
        this.shape.draw(context, uniforms, this.transform, this.material, this.drawType);
    }

    drawOverrideMaterial(context, uniforms, materialOverride) {
        this.shape.draw(context, uniforms, this.transform, materialOverride, this.drawType);
    }

    drawOverrideTransform(context, uniforms, transformOverride) {
        this.shape.draw(context, uniforms, transformOverride, this.material, this.drawType);
    }

    drawShadow(context, uniforms, materialOverride) {
        this.shape.draw(context, uniforms, this.transform, this.shadowMaterial, this.drawType);
    }

    drawShadowOverrideTransform(context, uniforms, transformOverride) {
        this.shape.draw(context, uniforms, transformOverride, this.shadowMaterial, this.drawType);
    }

    update(sceneObjects, uniforms, dt) { };

    fixedUpdate(sceneObjects, uniforms, dt) { };

}