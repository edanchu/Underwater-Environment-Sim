import { tiny, defs } from './examples/common.js';
import { Quaternion, quat } from './Quaternion.js';
import { utils } from './utils.js';
import { shaders } from './shaders.js';
import Particle from './Particle.js';

const { vec3, vec4, color, Mat4, Shape, Shader, Texture, Component } = tiny;

export const objects = {};

objects.WaterPlane = class WaterPlane extends utils.SceneObject {
    draw(context, uniforms) {
        this.shape.draw(context, uniforms, Mat4.translation(uniforms.camera_transform[0][3], 20, uniforms.camera_transform[2][3]), this.material, this.drawType);
    }
}

objects.trout = class trout extends utils.SceneObject {
    draw(context, uniforms) {
        // this.shape.draw(context, uniforms, Mat4.identity(), { ...this.material, roughness: document.getElementById('sld2').value, metallic: document.getElementById('sld1').value }, this.drawType);
        this.shape.draw(context, uniforms, this.transform, this.material, this.drawType);
    }
}

objects.boidsController = class boidsController extends utils.SceneObject {
    constructor(object, id, numBoids = 10, boundingBox = vec3(150, 80, 150)) {
        super(object.shape, object.material, Mat4.identity(), id, object.pass, object.drawType, object.castShadows, object.shadowMaterial);

        this.boundingBox = boundingBox.copy();
        this.boidsObject = object;
        this.numBoids = numBoids;

        this.boids = [];
        for (let i = 0; i < numBoids; i++) {
            this.boids.push(new Particle(3, vec3((Math.random() - 0.5) * this.boundingBox[0] / 10.0, (Math.random() - 0.5) * this.boundingBox[1] / 10.0, (Math.random() - 0.5) * this.boundingBox[2] / 10.0), "symplectic", false, vec3((Math.random() - 0.5) * 5, 5 * (Math.random() - 0.5), 5 * (Math.random() - 0.5))));
        }
    }

    update(sceneObjects, uniforms, dt) {

        this.centerForce(5);
        this.separateForce(3, 10);
        this.alignForce(3);
        this.limitVelocity(10);
        this.avoidWalls(500, 10);

        this.boids.map((x) => {
            x.update(dt);

            if (x.pos[0] > this.boundingBox[0] / 2) {
                x.setPosition(vec3(-this.boundingBox[0] / 2, x.pos[1], x.pos[2]));
            }
            else if (x.pos[0] < -this.boundingBox[0] / 2) {
                x.setPosition(vec3(this.boundingBox[0] / 2, x.pos[1], x.pos[2]));
            }
            if (x.pos[1] > this.boundingBox[1] / 2) {
                x.setPosition(vec3(x.pos[0], -this.boundingBox[1] / 2, x.pos[2]));
            }
            else if (x.pos[1] < -this.boundingBox[1] / 2) {
                x.setPosition(vec3(x.pos[0], this.boundingBox[1] / 2, x.pos[2]));
            }
            if (x.pos[2] > this.boundingBox[2] / 2) {
                x.setPosition(vec3(x.pos[0], x.pos[1], -this.boundingBox[2] / 2));
            }
            else if (x.pos[2] < -this.boundingBox[2] / 2) {
                x.setPosition(vec3(x.pos[0], x.pos[1], this.boundingBox[2] / 2));
            }
        })
    }

    draw(context, uniforms, sceneObjects) {
        this.boids.map((x) => {
            const base = vec3(-1, 0, 0);
            const desired = x.v.normalized();
            const axis = base.cross(desired);
            const angle = Math.acos(base.dot(desired));
            this.boidsObject.drawOverrideTransform(context, uniforms, Mat4.translation(...x.pos).times(Mat4.rotation(angle, ...axis)));
        })
    }

    drawShadow(context, uniforms) {
        this.boids.map((x) => {
            this.boidsObject.drawShadowOverrideTransform(context, uniforms, Mat4.translation(...x.pos));
        })
    }

    centerForce(centeringForce) {
        let center = vec3(0, 0, 0);
        this.boids.map((x) => {
            center.add_by(x.pos);
        })
        center.scale_by(1 / this.numBoids);
        this.boids.map((x) => x.addForce(center.minus(x.pos).times(centeringForce)));
    }

    separateForce(separationForce, minDist) {
        this.boids.map((x, i) => {
            this.boids.map((y, j) => {
                if (i !== j) {
                    const distance = x.pos.minus(y.pos);
                    if ((distance[0] !== 0 || distance[1] !== 0 || distance[2] !== 0) && distance.norm() <= minDist)
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
            if (Math.abs(x.pos[0] - (this.boundingBox[0] / 2)) < minDist)
                xFactor = -1;
            else if (Math.abs(x.pos[0] - (-this.boundingBox[0] / 2)) < minDist)
                xFactor = 1;
            if (Math.abs(x.pos[1] - (this.boundingBox[1] / 2)) < minDist)
                yFactor = -1;
            else if (Math.abs(x.pos[1] - (-this.boundingBox[1] / 2)) < minDist)
                yFactor = 1;
            if (Math.abs(x.pos[2] - (this.boundingBox[2] / 2)) < minDist)
                zFactor = -1;
            else if (Math.abs(x.pos[2] - (-this.boundingBox[2] / 2)) < minDist)
                zFactor = 1;

            x.addForce(vec3(xFactor * avoidanceForce, yFactor * avoidanceForce, xFactor * avoidanceForce));
        })
    }
}