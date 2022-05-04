import { tiny } from '../tiny-graphics.js'
const { vec3, Matrix } = tiny;

export class Quaternion {
    constructor(inS = 1, inV = vec3(0, 0, 0)) {
        this.s = inS;
        this.v = inV;
    }

    static create(...args) {
        return new Quaternion(...args);
    }

    setScalar(inS) {
        this.s = inS;
    }

    setVector(inV) {
        this.v = inV;
    }

    plus(q2) {
        return quat(this.s + q2.s, this.v.plus(q2.v));
    }

    times(q2) {
        return quat(this.s * q2.s - this.v.dot(q2.v), q2.v.times(this.s).plus(this.v.times(q2.s)).plus(this.v.cross(q2.v)));
    }

    norm() {
        return Math.sqrt(this.s * this.s + this.v[0] * this.v[0] + this.v[1] * this.v[1] + this.v[2] * this.v[2]);
    }

    normalized() {
        return quat(this.s, this.v).scale(1 / this.norm());
    }

    inverse() {
        return this.conjugate().scale(Math.pow(1 / Math.abs(this.norm()), 2));
    }

    scale(scalar) {
        return quat(this.s * scalar, this.v.times(scalar));
    }

    conjugate() {
        return quat(this.s, this.v.times(-1));
    }

    static fromAxisAngle(angle, axis) {
        axis = axis.normalized();
        return quat(Math.cos(angle / 2), axis.times(Math.sin(angle / 2)));
    }

    rotate(point) {
        point = quat(0, point);
        return this.times(point.times(this.inverse())).v;
    }

    toRotationMatrix() {
        let [d, a, b, c] = [this.s, this.v[0], this.v[1], this.v[2]];
        return Matrix.of([d * d + a * a - b * b - c * c, 2 * a * b - 2 * c * d, 2 * a * c + 2 * b * d, 0],
            [2 * a * b + 2 * c * d, d * d - a * a + b * b - c * c, 2 * b * c - 2 * a * d, 0],
            [2 * a * c - 2 * d * b, 2 * b * c + 2 * a * d, d * d - a * a - b * b + c * c, 0],
            [0, 0, 0, 1])
    }

    slerp(q2, t) {
        let angle = this.dot(q2);
        let c1 = Math.sin((1 - t) * angle) / Math.sin(angle);
        let c2 = Math.sin(t * angle) / Math.sin(angle);
        return this.scale(c1).plus(q2.scale(c2));
    }

    dot(q2) {
        return this.s * q2.s + this.v[0] * q2.v[0] + this.v[1] * q2.v[1] + this.v[2] * q2.v[2];
    }

    static fromEuler(x, y, z) {
        const cos = Math.cos;
        const sin = Math.sin;

        const c1 = cos(x / 2);
        const c2 = cos(y / 2);
        const c3 = cos(z / 2);

        const s1 = sin(x / 2);
        const s2 = sin(y / 2);
        const s3 = sin(z / 2);

        return quat(c1 * c2 * c3 + s1 * s2 * s3, vec3(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3));
    }

    static fromMatrix(mat) {
        const trace = mat[0][0] + mat[1][1] + mat[2][2];

        if (trace > 0) {

            const s = 0.5 / Math.sqrt(trace + 1.0);

            this.s = 0.25 / s;
            this.v = vec3((mat[2][1] - mat[1][2]) * s, (mat[0][2] - mat[2][0]) * s, (mat[1][0] - mat[0][1]) * s);

        } else if (mat[0][0] > mat[1][1] && mat[0][0] > mat[2][2]) {

            const s = 2.0 * Math.sqrt(1.0 + mat[0][0] - mat[1][1] - mat[2][2]);

            this.s = (mat[2][1] - mat[1][2]) / s;
            this.v = vec3(0.25 * s, (mat[0][1] + mat[1][0]) / s, (mat[0][2] + mat[2][0]) / s);

        } else if (mat[1][1] > mat[2][2]) {

            const s = 2.0 * Math.sqrt(1.0 + mat[1][1] - mat[0][0] - mat[2][2]);

            this.s = (mat[0][2] - mat[2][0]) / s;
            this.v = vec3((mat[0][1] + mat[1][0]) / s, 0.25 * s, (mat[1][2] + mat[2][1]) / s);

        } else {

            const s = 2.0 * Math.sqrt(1.0 + mat[2][2] - mat[0][0] - mat[1][1]);

            this.s = (mat[1][0] - mat[0][1]) / s;
            this.v = vec3((mat[0][2] + mat[2][0]) / s, (mat[1][2] + mat[2][1]) / s, 0.25 * s);

        }
    }

}

export const quat = Quaternion.create;