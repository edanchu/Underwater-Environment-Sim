import { shaders } from './shaders.js';
import { tiny    } from './tiny-graphics.js'
import { math    } from './tiny-graphics-math.js'
import { utils   } from './utils.js';

const { Shape      } = tiny;
const { Mat4, vec3 } = math;

export class WaterSim {
    #textureA;
    #textureB;
    #resx;
    #resy;
    #plane;
    #dropShader;
    #stepShader;
    #normalShader;

    // gl:   the gl context
    // resx: x-resolution of the water sim
    // resy: y-resolution of the water sim
    constructor(gl, resx, resy) {
        this.#textureA = this.#createTexture(gl, resx, resy); // we always read from textureA
        this.#textureB = this.#createTexture(gl, resx, resy); // and write to textureB
        this.#resx     = resx;
        this.#resy     = resy;
        this.#plane    = new Plane();

        this.#dropShader   = new shaders.WaterSimDropShader();
        this.#stepShader   = new shaders.WaterSimStepShader();
        this.#normalShader = new shaders.WaterSimNormalShader();
    }

    // Creates a floating point texture:
    #createTexture(gl, resx, resy) {
        const filter = gl.LINEAR; // assume hardware supports linear float filtering
        const wrap   = gl.CLAMP_TO_EDGE;

        const texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, resx, resy);

        return texture;
    }

    #swapTextures() {
        const temp     = this.#textureA;
        this.#textureA = this.#textureB;
        this.#textureB = temp;
    }

    // Renders the result to textureB. The rendering occurs in the renderFunction.
    #renderTextureB(gl, renderFunction) {
        // Save the old viewport state:
        const viewport = gl.getParameter(gl.VIEWPORT);

        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#textureB, 0);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

        if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            throw "Unsupported framebuffer.";
        }

        // We don't need any of these here:
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.DEPTH_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.viewport(0, 0, this.#resx, this.#resy);

        renderFunction();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);

        // enable these again
        gl.enable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
    }

    // Updates the texture with a drop as posx and posy with the specified radius and strength:
    drop(gl, posx, posy, radius, strength) {
        // Render the result to textureB:
        this.#renderTextureB(gl, _ => {
            const material = { 
                shader:   this.#dropShader,
                texture:  this.#textureA,
                posx:     posx,
                posy:     posy,
                radius:   radius,
                strength: strength
            };

            // We now draw this:
            this.#plane.draw({context: gl}, null, Mat4.identity(), material, "TRIANGLE_STRIP");
        });

        this.#swapTextures();
    }

    particleTexture() {
        return this.#textureA;
    }

    // Steps the simulation forward:
    step(gl) {
        // Render the result to textureB:
        this.#renderTextureB(gl, _ => {
            const material = { 
                shader:   this.#stepShader,
                texture:  this.#textureA,
                dimx:     1.0 / this.#resx,
                dimy:     1.0 / this.#resy,
            };

            // We now draw this:
            this.#plane.draw({context: gl}, null, Mat4.identity(), material, "TRIANGLE_STRIP");
        });

        this.#swapTextures();
    }

    // Update the normals:
    normals(gl) {
        // Render the result to textureB:
        this.#renderTextureB(gl, _ => {
            const material = { 
                shader:   this.#normalShader,
                texture:  this.#textureA,
                dimx:     1.0 / this.#resx,
                dimy:     1.0 / this.#resy,
            };

            // We now draw this:
            this.#plane.draw({context: gl}, null, Mat4.identity(), material, "TRIANGLE_STRIP");
        });

        this.#swapTextures();
    }
}

// A very basic 2x2 plane on the xy plane that is centered at (0, 0):
class Plane extends Shape {
    constructor() {
        super("position");
        // Drawn as a triangle strip:
        this.arrays.position = [vec3(-1, 1, 0), vec3(-1, -1, 0), vec3(1, 1, 0), vec3(1, -1, 0)];
        this.indices         = [0, 1, 2, 3];
    }
}