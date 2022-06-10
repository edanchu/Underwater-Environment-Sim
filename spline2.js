import {tiny, defs} from './examples/common.js';

// Pull these names into this module's scope for convenience:
const { vec3, vec4, color, Mat4, Shape, Material, Shader, Texture, Component } = tiny;


export
const Spline =
    class Spline {
        constructor(){
            this.points = [];
            this.tangents = [];
            this.size = 0;
        }

        add_point(x, y, z, tx, ty, tz){
            this.points.push(vec3(x, y, z));
            this.tangents.push(vec3(tx, ty, tz));
            this.size += 1;
        }

        get_position(t){
            if (this.size < 2){
                return vec3(0, 0, 0);
            }
            const A = Math.floor(t * (this.size - 1));
            const B = Math.ceil(t * (this.size - 1));
            const s = (t * (this.size - 1)) % 1.0;

            let a = this.points[A].copy();
            let b = this.points[B].copy();
            return a.times(1 - s).plus(b.times(s));

        }
    };

function h00(t) {
    return 2 * t ** 3 - 3 * t ** 2 + 1;
}

function h10(t) {
    return t ** 3 - 2 * t ** 2 + t;
}

function h01(t) {
    return -2 * t ** 3 + 3 * t ** 2;
}

function h11(t) {
    return t ** 3 - t ** 2;
}

export
const Hermite_Spline = 
    class Hermite_Spline extends Spline {

        get_position(t) { 
            if (this.size < 2) {
                return vec3(0, 0, 0);
            }
            //mapped index
            const A = Math.floor(t * (this.size - 1));
            const B = Math.ceil(t * (this.size - 1));

            const s = (t * (this.size - 1)) % 1.0;
            //points
            let a = this.points[A].copy();
            let b = this.points[B].copy();
            //tangents
            let a1 = this.tangents[A].copy();
            let b1 = this.tangents[B].copy();
            //scaling factors
            var xk = A/(this.size - 1);
            var xk1 = B/(this.size - 1);

            //spline equation
            let x = a.times(h00(s)).plus(a1.times(h10(s)).times(xk1 - xk)).plus(b.times(h01(s))).plus(b1.times(h11(s)).times(xk1 - xk));
            return x;
            //return a.times(1 - s).plus(b.times(s));
        }
    };
