import { tiny, defs } from './examples/common.js';
import { Quaternion, quat } from './Quaternion.js';
import { utils } from './utils.js';
import { shaders } from './shaders.js';
import Particle from './Particle.js';

const { vec3, vec4, color, Mat4, Matrix, Shape, Shader, Texture, Component } = tiny;

export const objects = {};

objects.WaterPlane = class WaterPlane extends utils.SceneObject {
    draw(context, uniforms) {
        this.shape.draw(context, uniforms, Mat4.translation(uniforms.camera_transform[0][3], 20, uniforms.camera_transform[2][3]), this.material, this.drawType);
    }
}

objects.trout = class trout extends utils.SceneObject {
    draw(context, uniforms) {
        this.shape.draw(context, uniforms, this.transform, this.material, this.drawType);
    }
}

objects.boidsController = class boidsController extends utils.SceneObject {
    constructor(object, id, numSchools = 10, boidsPerSchool = 20, center = vec3(0, 0, 0), boundingBox = [[-75, 75], [-15, 30], [-75, 75]]) {
        super(object.shape, object.material, Mat4.identity(), id, object.pass, object.drawType, object.castShadows, object.shadowMaterial);

        this.boundingBox = boundingBox;
        this.boidsObject = object;
        this.numSchools = numSchools;
        this.boidsPerSchool = boidsPerSchool;
        this.numBoids = boidsPerSchool * numSchools;

        this.centers = [];

        this.schools = [];
        for (let i = 0; i < numSchools; i++) {
            const schoolCenter = vec3((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 50 - 30, (Math.random() - 0.5) * 120);
            this.schools.push(new objects.boidsSchool(this.boidsPerSchool, schoolCenter, this.boundingBox, this.boidsObject.transform));
        }


        this.gpuInstances = new Map();
    }

    update(sceneObjects, uniforms, dt) {
        this.schools.map((x, i) => {
            x.update(sceneObjects, uniforms, dt);
            this.centers[i] = x.center;
        })
    }

    draw(context, uniforms, sceneObjects) {
        const gl = context.context;

        let matrices = new Float32Array(16 * this.numBoids);
        this.schools.map((x, i) => {
            matrices.set(x.getMatrices(), i * 16 * this.boidsPerSchool);
        })

        if (this.boidsObject.shape.ready) {

            const gpuInstance = this.copy_onto_graphics_card(context.context, matrices);
            this.material.shader.activate(context.context, gpuInstance.webGL_buffer_pointers, uniforms, Mat4.identity(), { ...this.material, fishPerSchool: this.fishPerSchool });

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpuInstance.index_buffer);
            gl.drawElementsInstanced(gl[this.boidsObject.drawType], this.boidsObject.shape.indices.length, gl.UNSIGNED_INT, 0, this.numBoids);
        }
    }

    drawShadow(context, uniforms) {
        const gl = context.context;

        let matrices = new Float32Array(16 * this.numBoids);
        this.schools.map((x, i) => {
            matrices.set(x.getMatrices(), i * 16 * this.boidsPerSchool);
        })

        if (this.boidsObject.shape.ready) {

            const gpuInstance = this.copy_onto_graphics_card(context.context, matrices);
            this.shadowMaterial.shader.activate(context.context, gpuInstance.webGL_buffer_pointers, uniforms, null, this.shadowMaterial);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpuInstance.index_buffer);
            gl.drawElementsInstanced(gl[this.boidsObject.drawType], this.boidsObject.shape.indices.length, gl.UNSIGNED_INT, 0, this.numBoids);
        }
    }

    copy_onto_graphics_card(context, matrices) {
        const defaults = { webGL_buffer_pointers: {} };

        const existing_instance = this.gpuInstances.get(context);

        const gpu_instance = existing_instance || this.gpuInstances.set(context, defaults).get(context);

        const gl = context;

        if (!existing_instance) {
            gpu_instance.webGL_buffer_pointers["position"] = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, gpu_instance.webGL_buffer_pointers["position"]);
            gl.bufferData(gl.ARRAY_BUFFER, Matrix.flatten_2D_to_1D(this.boidsObject.shape.arrays["position"]), gl.STATIC_DRAW);

            gpu_instance.webGL_buffer_pointers["normal"] = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, gpu_instance.webGL_buffer_pointers["normal"]);
            gl.bufferData(gl.ARRAY_BUFFER, Matrix.flatten_2D_to_1D(this.boidsObject.shape.arrays["normal"]), gl.STATIC_DRAW);

            gpu_instance.webGL_buffer_pointers["texture_coord"] = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, gpu_instance.webGL_buffer_pointers["texture_coord"]);
            gl.bufferData(gl.ARRAY_BUFFER, Matrix.flatten_2D_to_1D(this.boidsObject.shape.arrays["texture_coord"]), gl.STATIC_DRAW);

            gpu_instance.index_buffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu_instance.index_buffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.boidsObject.shape.indices), gl.STATIC_DRAW);
        }

        if (!existing_instance)
            gpu_instance.webGL_buffer_pointers["modelTransform_1"] = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu_instance.webGL_buffer_pointers["modelTransform_1"]);
        gl.bufferData(gl.ARRAY_BUFFER, matrices, gl.STATIC_DRAW);

        return gpu_instance;
    }

}

objects.boidsSchool = class boidsSchool {
    constructor(numBoids = 10, center = vec3(0, 0, 0), boundingBox = [[-75, 75], [-75, 15], [-75, 75]], initTransform) {

        this.boundingBox = boundingBox;
        this.numBoids = numBoids;
        this.initTransform = initTransform;

        this.boids = [];
        const initVel = vec3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 5);
        for (let i = 0; i < numBoids; i++) {
            const initPos = vec3(10 * (Math.random() - 0.5) + center[0], 10 * (Math.random() - 0.5) + center[1], 10 * (Math.random() - 0.5) + center[2]);
            this.boids.push(new Particle(3, initPos, "symplectic", false, initVel));
        }
    }

    update(sceneObjects, uniforms, dt) {

        this.centerForce(0.5);
        this.centerOfBoxForce(0.5);
        this.separateForce(0.3, 10);
        this.alignForce(0.2);
        this.avoidCamera(25, 6, uniforms);
        this.avoidWalls(20.0, 10);
        this.avoidPredators(50, 50, sceneObjects);
        this.limitVelocity(this.chased ? 20 : 10);

        this.boids.map((x) => {
            x.update(dt);
        })
    }

    getMatrices() {
        let matrices = new Float32Array(16 * this.numBoids);
        this.boids.map((x, i) => {
            const base = vec3(-1, 0, 0);
            const desired = x.v.normalized();
            const axis = base.cross(desired);
            const angle = Math.acos(base.dot(desired));
            matrices.set(Matrix.flatten_2D_to_1D((Mat4.translation(...x.pos).times(Mat4.rotation(angle, ...axis).times(this.initTransform))).transposed()), i * 16);
        })
        return matrices;
    }

    centerForce(centeringForce) {
        let center = vec3(0, 0, 0);
        this.boids.map((x) => {
            center.add_by(x.pos);
        })
        center.scale_by(1 / this.numBoids);
        this.center = center;
        this.boids.map((x) => x.addForce(center.minus(x.pos).times(centeringForce)));
    }

    centerOfBoxForce(centeringForce) {
        this.boids.map((x) => x.addForce(this.center.minus(x.pos).times(centeringForce)));
    }


    separateForce(separationForce, minDist) {
        this.boids.map((x, i) => {
            this.boids.map((y, j) => {
                if (i !== j) {
                    const distance = x.pos.minus(y.pos);
                    if (distance.norm() <= minDist)
                        x.addForce(distance.times(separationForce));
                }
            })
        })
    }

    alignForce(alignmentForce) {
        let vAvg = vec3(0, 0, 0);
        this.boids.map((x) => {
            vAvg.add_by(x.v);
        })
        vAvg.scale_by(1 / this.numBoids);

        this.boids.map((x) => x.addForce(vAvg.times(alignmentForce)));
    }

    avoidCamera(avoidForce, minDist, uniforms) {

        this.boids.map((x) => {
            const cameraDist = x.pos.minus(vec3(uniforms.camera_transform[0][3], uniforms.camera_transform[1][3], uniforms.camera_transform[2][3]));
            if (cameraDist.norm() < minDist)
                x.addForce(cameraDist.times(avoidForce));
        });
    }

    avoidPredators(avoidForce, minDist, sceneObjects) {
        this.chased = false;

        let predatorLocations = [];
        sceneObjects.map((x) => {
            if (x.id.includes("shark")) {
                predatorLocations.push(getPos(x.transform));
            }
        })

        this.boids.map((x) => {
            for (let i = 0; i < predatorLocations.length; i++) {
                const dir = x.pos.minus(predatorLocations[i]);
                const dist = dir.norm();
                if (dist < minDist) {
                    x.addForce(dir.normalized().times(avoidForce));
                    this.chased = true;
                }
            }
        });
    }

    limitVelocity(maxV) {
        this.boids.map((x) => {
            if (x.v.norm() > maxV) {
                x.v = x.v.normalized().times(maxV);
            }
        })
    }

    avoidWalls(avoidanceForce, minDist) {
        this.boids.map((x) => {
            let xFactor = 0, yFactor = 0, zFactor = 0;
            if (Math.abs(x.pos[0] - this.boundingBox[0][1]) < minDist)
                xFactor = -1;
            else if (Math.abs(x.pos[0] - this.boundingBox[0][0]) < minDist)
                xFactor = 1;
            if (Math.abs(x.pos[1] - this.boundingBox[1][1]) < minDist)
                yFactor = -10;
            else if (Math.abs(x.pos[1] - this.boundingBox[1][0]) < minDist)
                yFactor = 10;
            if (Math.abs(x.pos[2] - this.boundingBox[2][1]) < minDist)
                zFactor = -1;
            else if (Math.abs(x.pos[2] - this.boundingBox[2][0]) < minDist)
                zFactor = 1;

            x.addForce(vec3(xFactor * avoidanceForce, yFactor * avoidanceForce, zFactor * avoidanceForce));
        })
    }
}

objects.predator = class predator extends utils.SceneObject {
    constructor(object, id, transform, boundingBox = [[-75, 75], [-15, 30], [-75, 75]]) {
        super(object.shape, object.material, transform, id, object.pass, object.drawType, object.castShadows, object.shadowMaterial);

        this.boundingBox = boundingBox;
        this.initTransform = object.transform;

        this.particle = new Particle(1, getPos(this.transform), "symplectic");
    }

    update(sceneObjects, uniforms, dt) {
        this.huntForce(0.3, sceneObjects);
        this.avoidWalls(50, 10);
        this.avoidPredators(12.5, 40, sceneObjects);
        this.limitVelocity(15);

        this.particle.update(dt);

        const base = vec3(1, 0, 0);
        const desired = this.particle.v.normalized();
        const axis = base.cross(desired);
        const angle = Math.acos(base.dot(desired));
        this.transform = Mat4.translation(...this.particle.pos).times(Mat4.rotation(angle, ...axis));
    }

    huntForce(centerForce, sceneObjects) {
        let centers = [];
        sceneObjects.map((x) => {
            if (x.id.includes("boids"))
                centers.push(...x.centers);
        });

        let closest = { distance: 99999, index: 0 };
        for (let i = 0; i < centers.length; i++) {
            const dist = centers[i].minus(this.particle.pos).norm();
            if (dist <= closest.distance) {
                closest.distance = dist;
                closest.index = i;
            }
        }
        const f = centers[closest.index].minus(this.particle.pos).times(centerForce);
        this.particle.addForce(f);
    }

    avoidPredators(avoidForce, minDist, sceneObjects) {
        let predatorLocations = [];
        sceneObjects.map((x) => {
            if (x.id.includes("shark") && x.id != this.id) {
                predatorLocations.push(getPos(x.transform));
            }
        })

        for (let i = 0; i < predatorLocations.length; i++) {
            const dir = this.particle.pos.minus(predatorLocations[i]);
            const dist = dir.norm();
            if (dist < minDist) {
                this.particle.addForce(dir.normalized().times(avoidForce));
            }
        }
    }

    limitVelocity(maxV) {
        if (this.particle.v.norm() > maxV) {
            this.particle.v = this.particle.v.normalized().times(maxV);
        }
    }

    avoidWalls(avoidanceForce, minDist) {
        const x = this.particle;
        let xFactor = 0, yFactor = 0, zFactor = 0;
        if (Math.abs(x.pos[0] - this.boundingBox[0][1]) < minDist)
            xFactor = -1;
        else if (Math.abs(x.pos[0] - this.boundingBox[0][0]) < minDist)
            xFactor = 1;
        if (Math.abs(x.pos[1] - this.boundingBox[1][1]) < minDist)
            yFactor = -1;
        else if (Math.abs(x.pos[1] - this.boundingBox[1][0]) < minDist)
            yFactor = 1;
        if (Math.abs(x.pos[2] - this.boundingBox[2][1]) < minDist)
            zFactor = -1;
        else if (Math.abs(x.pos[2] - this.boundingBox[2][0]) < minDist)
            zFactor = 1;

        this.particle.addForce(vec3(xFactor * avoidanceForce, yFactor * avoidanceForce, zFactor * avoidanceForce));
    }

    draw(context, uniforms) {
        this.shape.draw(context, uniforms, this.transform.times(this.initTransform), this.material, this.drawType);
    }

    drawShadow(context, uniforms) {
        this.shape.draw(context, uniforms, this.transform.times(this.initTransform), this.shadowMaterial, this.drawType);
    }
}

function getPos(mat) {
    return vec3(mat[0][3], mat[1][3], mat[2][3]);
}