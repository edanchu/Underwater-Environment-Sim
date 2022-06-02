import { tiny } from '../tiny-graphics.js'
import { defs } from './examples/common-shapes.js'

const { Vector3, vec3, vec4, Mat4, Shape, Matrix } = tiny;
const { Cylindrical_Tube, Subdivision_Sphere } = defs;
export
    const HermiteSpline =
        class HermiteSpline extends Shape {
            constructor() {
                super('position', 'normal');
                this.arrays.position = [];
                this.arrays.normal = [];
                this.indices = [];

                this.controlPoints = [];
                this.requiresResendToGPU = false;
                this.meshUpToDate = false;
            }

            addPoint(position, tangent) {
                this.controlPoints.push({ pos: position, tan: tangent });
                this.meshUpToDate = false;
            }

            editPoint(index, position, tangent) {
                const scale = 1 / (this.controlPoints.length - 1);
                if (this.startIndex >= this.controlPoints.length - 1) { console.error("nonexistent control point"); return -1; }
                if (position != false)
                    this.controlPoints[index].pos = position;
                if (index == 0) {
                    this.controlPoints[index].tan = this.controlPoints[index + 1].pos.minus(this.controlPoints[index].pos).times(1 / (2 * scale))
                }
                else if (index == this.controlPoints.length - 1) {
                    this.controlPoints[index].tan = this.controlPoints[index - 1].pos.minus(this.controlPoints[index].pos).times(1 / (2 * scale))
                }
                else {
                    this.controlPoints[index].tan = this.controlPoints[index + 1].pos.minus(this.controlPoints[index - 1].pos).times(1 / (2 * scale));
                }
                this.meshUpToDate = false;
            }

            getArcLength() {
                let points = [];
                let subdivisions = 100 * (this.controlPoints.length - 1);
                for (let i = 0; i <= subdivisions; i++) {
                    points.push(this.getPos(i / (subdivisions)));
                }
                let length = 0;
                for (let i = 0; i < points.length - 1; i++) {
                    length += (points[i + 1].minus(points[i])).norm();
                }
                return length;
            }

            getPos(inT) {
                if (this.controlPoints.length < 2) { console.error("incomplete spline"); return -1; }

                const startIndex = Math.floor(inT * (this.controlPoints.length - 1));
                const endIndex = Math.ceil(inT * (this.controlPoints.length - 1));
                const t = (inT * (this.controlPoints.length - 1)) % 1;

                const t2 = t * t;
                const t3 = t2 * t;
                const scale = 1 / (this.controlPoints.length - 1);
                return this.controlPoints[startIndex].pos.times(h_00(t, t2, t3)).plus(this.controlPoints[startIndex].tan.times(h_10(t, t2, t3) * scale)).plus(
                    this.controlPoints[endIndex].pos.times(h_01(t, t2, t3))).plus(this.controlPoints[endIndex].tan.times(h_11(t, t2, t3) * scale));
            }

            generateMesh() {
                this.arrays.position = [];
                this.arrays.normal = [];
                this.indices = [];
                let subdivisions = 3 * (this.controlPoints.length - 1), resolution = 5;
                let pos, nextPos, segment, circ;
                for (let i = 0; i < subdivisions; i++) {
                    pos = this.getPos(i / subdivisions);
                    nextPos = this.getPos((i + 1) / subdivisions);
                    segment = nextPos.minus(pos);
                    let circ = getCircle(pos, segment.normalized(), resolution + 1);
                    this.arrays.position.push(...circ[0]);
                    this.arrays.normal.push(...circ[1]);
                }
                circ = getCircle(this.getPos(1), segment.normalized(), resolution + 1);
                this.arrays.position.push(...circ[0]);
                this.arrays.normal.push(...circ[1]);

                for (let i = 0; i < subdivisions; i++) {
                    let base1 = i * (resolution + 1);
                    let base2 = base1 + resolution;
                    for (let j = 0; j <= resolution; j++) {
                        this.indices.push(base1, base1 + 1, base2, base2 + 1, base1 + 1);
                        base1++;
                        base2++;
                    }
                }
                this.requiresResendToGPU = true;
                this.meshUpToDate = true;
            }

            draw(webgl_manager, uniforms, model_transform, material, type = "TRIANGLE_STRIP") {
                if (this.meshUpToDate == false) this.generateMesh();
                if (this.requiresResendToGPU == true) {
                    this.copy_onto_graphics_card_new_vertices(webgl_manager.context);
                    this.requiresResendToGPU == false;
                }
                const gpu_instance = this.gpu_instances.get(webgl_manager.context) || this.copy_onto_graphics_card(webgl_manager.context);
                material.shader.activate(webgl_manager.context, gpu_instance.webGL_buffer_pointers, uniforms, model_transform, material);
                this.execute_shaders(webgl_manager.context, gpu_instance, type);
            }

            listPoints() {
                let output = "" + this.controlPoints.length + "\n";
                for (let i = 0; i < this.controlPoints.length; i++) {
                    for (let j = 0; j < 3; j++)
                        output += this.controlPoints[i].pos[j] + " ";
                    for (let j = 0; j < 3; j++)
                        output += this.controlPoints[i].tan[j] + " ";
                    output += "\n";
                }
                return output;
            }

            loadPoints(input) {
                this.controlPoints = [];
                this.requiresResendToGPU == false;

                let points = input.split("\n");
                if (points[0] < 2) { console.error("invalid num points"); return -1; }
                for (let i = 0; i < points[0]; i++) {
                    let currPoint = points[i + 1].split(" ");
                    if (currPoint.length < 6) { console.error("invalid control point at index " + i); return -1; }
                    this.addPoint(vec3(currPoint[0], currPoint[1], currPoint[2]), vec3(currPoint[3], currPoint[4], currPoint[5]));
                }
                this.meshUpToDate == false;
            }

            copy_onto_graphics_card_new_vertices(context, selection_of_arrays = Object.keys(this.arrays), write_to_indices = true) {
                // Define what this object should store in each new WebGL Context:
                const defaults = { webGL_buffer_pointers: {} };

                // When this Shape sees a new GPU context (in case of multiple drawing areas), copy the Shape to the GPU. If
                // it already was copied over, get a pointer to the existing instance.
                const existing_instance = this.gpu_instances.get(context);

                // If this Shape was never used on this GPU context before, then prepare new buffer indices for this context.
                const gpu_instance = existing_instance || this.gpu_instances.set(context, defaults).get(context);

                const gl = context;

                const write = existing_instance ? (target, data) => gl.bufferSubData(target, 0, data)
                    : (target, data) => gl.bufferData(target, data, gl.STATIC_DRAW);

                for (let name of selection_of_arrays) {
                    if (!existing_instance)
                        gpu_instance.webGL_buffer_pointers[name] = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, gpu_instance.webGL_buffer_pointers[name]);
                    write(gl.ARRAY_BUFFER, Matrix.flatten_2D_to_1D(this.arrays[name]));
                }
                if (this.indices.length && write_to_indices) {
                    if (!existing_instance)
                        gpu_instance.index_buffer = gl.createBuffer();
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu_instance.index_buffer);
                    write(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.indices));
                }
                return gpu_instance;
            }
        }

function getCircle(point, normal, segments, radius = 0.4) {
    normal = normal.normalized()
    let verts = [], norms = [];
    let v = vec3(0.125, 81.1, 9.2817).normalized();
    if (v.dot(normal) == 0) v = vec3(1, 1, -(point[0] + point[1])).normalized();
    let v1 = normal.cross(v).normalized();
    let v2 = normal.cross(v1).normalized();
    for (let i = 0; i < segments; i++) {
        let angle = i * 2 * Math.PI / segments;
        verts.push(point.plus(v1.times(Math.cos(angle) * radius)).minus(v2.times(Math.sin(angle) * radius)));
        norms.push(verts[verts.length - 1].minus(point).normalized());
    }
    return [verts, norms];
}

function h_00(x, x2, x3) {
    return 2 * x3 - 3 * x2 + 1;
};

function h_10(x, x2, x3) {
    return x3 - 2 * x2 + x;
};

function h_01(x, x2, x3) {
    return -2 * x3 + 3 * x2;
};

function h_11(x, x2, x3) {
    return x3 - x2;
};

function align(v1, v2) {
    let axis = v1.cross(v2).normalized();
    let dot = Math.min(1, Math.max(0, v1.dot(v2)));
    let angle = Math.acos(dot);
    return Mat4.rotation(angle, axis[0], axis[1], axis[2]);
}


export default HermiteSpline;