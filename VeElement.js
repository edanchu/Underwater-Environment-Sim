import { tiny } from '../tiny-graphics.js'

const { Vector3, vec3, Mat4, Shape } = tiny;

class VeElement extends Shape {
    constructor(particle1, particle2, springConstant, natLength, dampConstant) {
        super('position', 'normal');
        this.arrays.position = [];
        this.arrays.normal = [vec3(0, 0, 0), vec3(0, 0, 0)];

        this.p1 = particle1;
        this.p2 = particle2;
        this.ks = springConstant;
        this.kd = dampConstant;
        this.l = natLength < 0 ? this.p1.pos.minus(this.p2.pos).norm() : natLength;
    }

    setSpringConstant(newKs) {
        this.ks = newKs;
    }

    setDamperConstant(newKd) {
        this.kd = newKd;
    }

    setP1(newP1) {
        this.p1 = newP1;
    }

    setP2(newP2) {
        this.p2 = newP2;
    }

    setLength(newL) {
        this.l = newL < 0 ? (this.p1.pos.minus(this.p2.pos)).norm() : newL;
    }

    computeForce() {
        let distance = this.p2.pos.minus(this.p1.pos);
        let normdist = distance.normalized();
        let springForce = normdist.times(this.ks * (distance.norm() - this.l));
        let damperForce = normdist.times(this.kd * ((this.p2.v.minus(this.p1.v)).dot(normdist)));
        return springForce.plus(damperForce);
    }

    applyForce() {
        let force = this.computeForce();
        this.p1.f.add_by(force);
        this.p2.f.subtract_by(force);
    }

    draw(context, uniforms, material) {
        this.arrays.position = [this.p1.pos, this.p2.pos];
        this.copy_onto_graphics_card(context.context);
        super.draw(context, uniforms, Mat4.identity(), material, "LINE_STRIP");
    }
}

export default VeElement;