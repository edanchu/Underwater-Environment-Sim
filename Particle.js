import { tiny } from '../tiny-graphics.js'

const { Vector3, vec3, Mat4 } = tiny;

class Particle {
    constructor(mass, initPosition, integration = "euler", anchored = false, initVelocity = vec3(0, 0, 0), initForce = vec3(0, 0, 0)) {
        this.im = 1 / mass;
        this.f = initForce;
        this.v = initVelocity;
        this.pos = initPosition;
        this.prevPos = this.pos.minus(this.v.times(0.001));
        this.iType = integration;
        this.anchored = anchored;
    }

    setMass(newMass) {
        this.im = 1 / newMass;
    }

    setVelocity(newVel) {
        this.v = newVel;
        this.prevPos = this.pos.minus(this.v.times(0.001));
    }

    //doesnt update velocity
    setPosition(newPos) {
        this.pos = newPos;
        this.prevPos = this.pos.minus(this.v.times(0.001));
    }

    //updates velocity
    move(newPos, dt) {
        this.prevPos = this.pos;
        this.pos = newPos;
        this.v = this.pos.minus(this.prevPos).times(1 / dt);
    }

    setForce(newForce) {
        this.f = newForce;
    }

    update(dt) {
        if (this.anchored == false) {
            switch (this.iType) {
                case "euler":
                    this.updateEuler(dt);
                    break;
                case "symplectic":
                    this.updateSymplectic(dt);
                    break;
                case "verlet":
                    this.updateVerlet(dt);
                    break;
            }
        }
        this.f = vec3(0, 0, 0);
    }

    updateEuler(dt) {
        this.prevPos = this.pos;
        this.pos.add_by(this.v.times(dt));
        this.v.add_by(this.f.times(dt * this.im));
        this.f = vec3(0, 0, 0);
    }

    updateSymplectic(dt) {
        this.prevPos = this.pos;
        this.v.add_by(this.f.times(dt * this.im));
        this.pos.add_by(this.v.times(dt));
        this.f = vec3(0, 0, 0);
    }

    updateVerlet(dt) {
        let nextPos = this.pos.times(2).minus(this.prevPos).plus(this.f.times(dt * dt * this.im));
        this.v = this.pos.minus(this.prevPos).times(1 / dt);
        this.prevPos = this.pos;
        this.pos = nextPos;
        this.f = vec3(0, 0, 0);
    }

    addForce(force) {
        this.f.add_by(force);
    }

    addAcceleration(acc) {
        if (this.anchored == false) {
            this.f.add_by(acc.times(1 / this.im));
        }
    }
}

export default Particle;