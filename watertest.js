//import { tiny     } from './tiny-graphics.js'
import { math     } from './tiny-graphics-math.js'
import { shaders  } from  './shaders.js';
import { WaterSim } from './watersim.js';
import { tiny     } from './examples/common.js';

const { Shape, Component, Shader } = tiny;
const { Mat4, vec3,              } = math;

export class WaterTest extends Component {
    #waterSim;
    #waterMesh;
    #waterShader;
    #waterMaterial;

    init_context(context) {
        const gl = context.context;

        // Construct the water sim:
        this.#waterSim    = new WaterSim(gl, 256, 256);
        this.#waterMesh   = new WaterPlane(200, 200);
        this.#waterShader = new shaders.WaterMeshShader();

        this.#waterMaterial = {
            shader:        this.#waterShader,
            texture:       null, // will be set later
            lightPosition: vec3(2, 2, 2),
        };

        // Initialize the water with some drops:
        for (var i = 0; i < 20; i++) {
            this.#waterSim.drop(gl, Math.random() * 2 - 1, Math.random() * 2 - 1, 0.03, (i & 1) ? 0.01 : -0.01);
        }

        // Assign the camera:
        Shader.assign_camera(Mat4.look_at(vec3(3, 3, 3), vec3(0, 0, 0), vec3(0, 1, 0)), this.uniforms);
        this.uniforms.projection_transform = Mat4.perspective(Math.PI / 4, context.width / context.height, 1, 100);
    }

    render_animation(context) {
        const gl = context.context;

        this.#waterSim.step(gl);
        this.#waterSim.step(gl);
        this.#waterSim.normals(gl);

        // Update the texture:
        this.#waterMaterial.texture = this.#waterSim.particleTexture();
        this.#waterMesh.draw({context: gl}, this.uniforms, Mat4.identity(), this.#waterMaterial);
    }
}

// The water plane:
class WaterPlane extends Shape {
    // Constructs the shape, using detailx and detaily to specify a resolution:
    constructor(detailx, detaily) {
        super("position");

        this.arrays.position = [];
        this.indices         = [];

        for (let y = 0; y <= detaily; y++) {
            const t = y / detaily;
            for (let x = 0; x <= detailx; x++) {
                const s = x / detailx;
                this.arrays.position.push(vec3(2 * s - 1, 2 * t - 1, 0));

                if (x < detailx && y < detaily) {
                    const i = x + y * (detailx + 1);
                    this.indices.push(i, i + 1, i + detailx + 1);
                    this.indices.push(i + detailx + 1, i + 1, i + detailx + 2);
                }
            }
        }
    }
}