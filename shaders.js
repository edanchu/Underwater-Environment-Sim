import { tiny } from './tiny-graphics.js'
import { math } from './tiny-graphics-math.js'

const { Vector, Vector3, vec3, vec4, Mat4, Matrix } = math;

export const shaders = {};

shaders.WaterMeshShader = class WaterMeshShader extends tiny.Shader {
    update_GPU(gl, gpu_addresses, uniforms, model_transform, material) {
        const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform];
        const PCM       = P.times(C).times(M);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, material.texture);
        gl.uniform1i(gpu_addresses.particles, 0);

        gl.uniformMatrix4fv(gpu_addresses.pcm, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
        gl.uniform3fv(gpu_addresses.lightPosition, material.lightPosition);
    }

    shared_glsl_code() {
        return `#version 300 es
        precision highp float;
        `;
    }

    vertex_glsl_code() {
        return this.shared_glsl_code() + `
            in vec3 position;

            uniform sampler2D particles;
            uniform mat4      pcm;

            out vec3 pos;

            void main() {
                // Sample the height of the particle:
                vec4 particle = texture(particles, position.xy * 0.5 + 0.5);

                // Update the position with the height:
                pos    = position.xzy;
                pos.y += particle.r;

                gl_Position = pcm * vec4(pos, 1.0);
            }
        `;
    }

    // Basic phong-shader for now to make sure the ripples are present:
    fragment_glsl_code() {
        return this.shared_glsl_code() + `
            uniform sampler2D particles;
            uniform vec3      lightPosition;

            in  vec3 pos;
            out vec4 fragColor;

            void main() {
                vec2 coord    = pos.xz * 0.5 + 0.5;
                vec4 particle = texture(particles, coord);

                for (int i = 0; i < 5; i++) {
                    coord   += particle.ba * 0.005; // the normal
                    particle = texture(particles, coord);
                }

                vec3 normal = vec3(particle.b, sqrt(1.0 - dot(particle.ba, particle.ba)), particle.a);
                
                // ambient:
                float ambientStrength = 0.1;
                vec3  ambient         = ambientStrength * vec3(0, 0.1, 0.6); // white light color

                // diffuse:
                vec3 lightDir = normalize(lightPosition - pos);
                vec3 diffuse  = max(dot(normal, lightDir), 0.0) * vec3(0.1, 0.3, 0.7);

                fragColor = vec4(ambient + diffuse, 1.0);
            }
        `;
    }
}

// Particles are written as: (pos.y, vel.y, nrm.x, nrm.z)

// This shader handles updating the normal information of the particle to allow
// us to render the water:
shaders.WaterSimNormalShader = class WaterSimNormalShader extends tiny.Shader {
    // The material will hold information about the click and whatnot.
    update_GPU(gl, gpu_addresses, _uniforms, _model_transform, material) {
        // The texture with the current state:
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, material.texture);
        gl.uniform1i(gpu_addresses.particles, 0);

        // Update particle information:
        gl.uniform1f(gpu_addresses.deltax, material.deltax);
        gl.uniform1f(gpu_addresses.deltay, material.deltay);
    }

    shared_glsl_code() {
        return `#version 300 es
        precision highp float;
        `;
    }

    vertex_glsl_code() {
        return this.shared_glsl_code() + `
            in  vec3 position;
            out vec2 coord;

            void main() {
                coord       = position.xy * 0.5 + 0.5;
                gl_Position = vec4(position.xyz, 1.0);
            }
        `;
    }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
            uniform sampler2D particles;
            uniform float     deltax;
            uniform float     deltay;

            in  vec2 coord;
            out vec4 fragColor;

            void main() {
                vec2 delta    = vec2(deltax, deltay);
                vec4 particle = texture(particles, coord);

                vec3 dx = vec3(delta.x, texture(particles, vec2(coord.x + delta.x, coord.y)).r - particle.r, 0.0);
                vec3 dy = vec3(0.0, texture(particles, vec2(coord.x, coord.y + delta.y)).r - particle.r, delta.y);

                particle.ba = normalize(cross(dy, dx)).xz;

                fragColor = particle;
            }
        `;
    }
}

// Given the current particle buffer, this shader updates the values:
shaders.WaterSimStepShader = class WaterSimStepShader extends tiny.Shader {
    update_GPU(gl, gpu_addresses, _uniforms, _model_transform, material) {
        // The texture with the current state:
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, material.texture);
        gl.uniform1i(gpu_addresses.particles, 0);

        // Update particle information:
        gl.uniform1f(gpu_addresses.deltax, material.deltax);
        gl.uniform1f(gpu_addresses.deltay, material.deltay);
    }

    shared_glsl_code() {
        return `#version 300 es
        precision highp float;
        `;
    }

    vertex_glsl_code() {
        return this.shared_glsl_code() + `
            in  vec3 position;
            out vec2 coord;

            void main() {
                coord       = position.xy * 0.5 + 0.5;
                gl_Position = vec4(position.xyz, 1.0);
            }
        `;
    }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
            uniform sampler2D particles;
            uniform float     deltax;
            uniform float     deltay;

            in  vec2 coord;
            out vec4 fragColor;

            void main() {
                vec2 delta    = vec2(deltax, deltay);
                vec4 particle = texture(particles, coord);

                vec2 dx = vec2(delta.x, 0.0);
                vec2 dy = vec2(0.0, delta.y);

                float average = (
                    texture(particles, coord - dx).r +
                    texture(particles, coord - dy).r +
                    texture(particles, coord + dx).r +
                    texture(particles, coord + dy).r
                ) * 0.25;

                particle.g += (average - particle.r) * 2.0;
                particle.g *= 0.995;
                particle.r += particle.g;

                fragColor = particle;
            }
        `;
    }
};

shaders.WaterSimDropShader = class WaterSimDropShader extends tiny.Shader {
    update_GPU(gl, gpu_addresses, _uniforms, _model_transform, material) {
        // The texture with the current state:
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, material.texture);
        gl.uniform1i(gpu_addresses.particles, 0);

        // Specify the drop information:
        gl.uniform1f(gpu_addresses.centerx,  material.posx);
        gl.uniform1f(gpu_addresses.centery,  material.posy);
        gl.uniform1f(gpu_addresses.radius,   material.radius);
        gl.uniform1f(gpu_addresses.strength, material.strength);
    }

    shared_glsl_code() {
        return `#version 300 es
        precision highp float;
        `;
    }

    vertex_glsl_code() {
        return this.shared_glsl_code() + `
            in  vec3 position;
            out vec2 coord;

            void main() {
                coord       = position.xy * 0.5 + 0.5;
                gl_Position = vec4(position.xyz, 1.0);
            }
        `;
    }

    fragment_glsl_code() {
        return this.shared_glsl_code() + `
            const float PI = 3.14159265358979323846;

            uniform sampler2D particles;
            uniform float     centerx;
            uniform float     centery;
            uniform float     radius;
            uniform float     strength;

            in  vec2 coord;
            out vec4 fragColor;

            float volumeInSphere(vec3 center) {
                vec3 toCenter = vec3(coord.x * 2.0 - 1.0, 0.0, coord.y * 2.0 - 1.0) - center;
                float t = length(toCenter) / radius;
                float dy = exp(-pow(t * 1.5, 6.0));
                float ymin = min(0.0, center.y - dy);
                float ymax = min(max(0.0, center.y + dy), ymin + 2.0 * dy);
                return (ymax - ymin) * 0.1;
            }

            void main() {
                vec2 center   = vec2(centerx, centery);
                vec4 particle = texture(particles, coord);

                // float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
                //       drop = 0.5 - cos(drop * PI) * 0.5;

                // particle.r += drop * strength;

                // calculate new sphere location in 3D;
                vec3 newCenter = vec3(center, -strength);
                vec3 oldCenter = vec3(center, strength);

                particle.r += volumeInSphere(oldCenter);
                particle.r -= volumeInSphere(newCenter);

                fragColor = particle;
            }
        `;
    }
};

//
// ---------------------------------------------------------------------------------
//

shaders.WaterSurfaceShader = class WaterSurfaceShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const PC = uniforms.projection_transform.times(uniforms.camera_inverse);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_transform, false, Matrix.flatten_2D_to_1D(PC.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.viewMatrix, false, Matrix.flatten_2D_to_1D(uniforms.camera_inverse.transposed()));

    context.uniform3fv(gpu_addresses.cameraCenter, uniforms.camera_transform.times(vec4(0, 0, 0, 1)).to3());

    context.uniform4fv(gpu_addresses.color, material.color);
    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);

    material.waterFlow.activate(context, 1);
    context.uniform1i(gpu_addresses.waterFlow, 1);
    material.waterDerivativeHeight.activate(context, 2);
    context.uniform1i(gpu_addresses.waterDerivativeHeight, 2);

    context.uniform1f(gpu_addresses.planeSize, material.planeSize);

    // Bind the water particle texture:

    const gl = context;

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, material.waterParticles);
    gl.uniform1i(gpu_addresses.particles, 3);
  }

  shared_glsl_code() {
    return `#version 300 es
            precision mediump float;
    `;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
      in vec3 position;
      in vec3 normal;   
      in vec2 texture_coord;    
      
      uniform sampler2D particles;

      uniform mat4 projection_camera_transform;
      uniform mat4 modelTransform;
      uniform mat4 viewMatrix;
      uniform vec3 cameraCenter;
      uniform float planeSize;

      out vec3 vertexWorldspace;
      out vec3 localPosition;
      out vec2 texCoord;

      void main() {
        texCoord = texture_coord; // + vec2(cameraCenter.x, -cameraCenter.z) / planeSize;

        // Distort the position:
        vec4 particle = texture(particles, texCoord);
        vec3 newPos   = position;
        newPos.y     += particle.r;

        localPosition = newPos;

        vec3 p = (modelTransform * vec4(newPos, 1.0)).xyz;

        gl_Position = projection_camera_transform * vec4( p, 1.0 );
        vertexWorldspace = p; 
      }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
      out vec4 FragColor;

      uniform sampler2D waterFlow;
      uniform sampler2D waterDerivativeHeight;
      uniform sampler2D particles;
      uniform float time;
      uniform vec4 color;
      uniform vec3 cameraCenter;

      in vec3 vertexWorldspace;
      in vec3 localPosition;
      in vec2 texCoord;

      vec3 Distort (vec2 uv, vec2 flowVector, vec2 jump, float flowOffset, float tiling, float time, bool flowB) {
          float phaseOffset = flowB ? 0.5 : 0.0;
          float progress = fract(time + phaseOffset);
          vec3 uvw;
          uvw.xy = uv - flowVector * (progress + flowOffset);
          uvw.xy *= tiling;
          uvw.xy += phaseOffset;
          uvw.xy += (time - progress) * jump;
          uvw.z = 1.0 - abs(1.0 - 2.0 * progress);
          return uvw;
      }
      
      vec3 UnpackDerivativeHeight(vec4 textureData) {
          vec3 dh = textureData.agb;
          dh.xy = dh.xy * 2.0 - 1.0;
          return dh;
      }

      void main() {
        vec3 flow = texture(waterFlow, texCoord).xyz;
        flow.xy = flow.xy * 2.0 - 1.0;
        flow *= 0.3;
        vec3 uvwA = Distort(texCoord, flow.xy, vec2(0.24), -0.5, 15.0, time / 25.0, false);
        vec3 uvwB = Distort(texCoord, flow.xy, vec2(0.24), -0.5, 15.0, time / 25.0, true);
        float heightScale = (flow.z * 0.25 + 0.75) * 0.2;
        vec3 dhA = UnpackDerivativeHeight(texture(waterDerivativeHeight, uvwA.xy)) * uvwA.z * heightScale;
        vec3 dhB = UnpackDerivativeHeight(texture(waterDerivativeHeight, uvwB.xy)) * uvwB.z * heightScale;
        mat3 tbn = mat3(vec3(1,0,0), vec3(0,0,1), vec3(0,1,0));
        vec3 textNormal = tbn * normalize(vec3(-(dhA.xy + dhB.xy), 1.0));

        vec2 coord    = texCoord;
        vec4 particle = texture(particles, coord);

        for (int i = 0; i < 5; i++) {
            coord   += particle.ba * 0.005; // the normal
            particle = texture(particles, coord);
        }

        vec3 normal = vec3(particle.b, sqrt(1.0 - dot(particle.ba, particle.ba)), particle.a);

        if (normal == vec3(0.0, 1.0, 0.0)) {
            normal = textNormal;
        } else {
            normal = mix(normal, textNormal, 0.4);
        }
        
        vec3 viewDir = normalize(vertexWorldspace - cameraCenter);
        float angle = acos(dot(viewDir, normal));
        float limit = mix(0.0, 0.95, 1.0 - min((abs(cameraCenter.y - vertexWorldspace.y))/200.0, 1.0));
        // limit = mix(limit, 0.0, clamp(length(vertexWorldspace.xz - cameraCenter.xz)/80.0, 0.0, 1.0));
        vec3 waterColor = color.xyz * localPosition.y;
        waterColor = mix(waterColor, vec3(.09, 0.195, 0.33)  /2.0, clamp(1.0 - pow(1.0 - length(vertexWorldspace.xz - cameraCenter.xz) / 150.0, 3.0), 0.0, 1.0));
        waterColor = mix(waterColor, vec3(.09, 0.195, 0.33) / 2.0, clamp(1.0 - pow(1.0 - (vertexWorldspace.y - cameraCenter.y) / 400.0, 2.0), 0.0, 1.0));
        float b = step(clamp(angle, 0.0, 1.0), limit);
        vec3 finColor = b * mix(color.xyz, vec3(3,3,3), clamp(1.0 - angle, 0.0, 1.0)) + (1.0 - b)*waterColor;
        
        FragColor = vec4(finColor, 1.0);
      }`;
  }
};

shaders.GeometryShader = class GeometryShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PCM = P.times(C).times(M);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.normalMatrix, false, Matrix.flatten_2D_to_1D(Mat4.inverse(model_transform)));

    context.uniform4fv(gpu_addresses.color, material.color);
    context.uniform4fv(gpu_addresses.specularColor, material.specularColor);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;

    out vec3 vPos;
    out vec3 vNorm;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;
    uniform mat4 normalMatrix;

    void main() { 
      gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
      vPos = (modelTransform * vec4(position, 1.0)).xyz;
      vNorm = normalize(mat3(normalMatrix) * normal);
      //vNorm = normalize((modelTransform * vec4(normal, 1.0)).xyz);

    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    layout (location = 0) out vec4 FragPosition;
    layout (location = 1) out vec4 FragNormal;
    layout (location = 2) out vec4 FragAlbedo;
    layout (location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;

    uniform vec4 color;
    uniform vec4 specularColor;

    void main() {                                                   
      FragPosition = vec4(vPos, 1.0);
      FragNormal = vec4(vNorm, 1.0);
      FragAlbedo = color;
      FragSpecular = specularColor;
    }`;
  }
}

shaders.GeometryShaderInstanced = class GeometryShaderInstanced extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C] = [uniforms.projection_transform, uniforms.camera_inverse], PC = P.times(C);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_transform, false, Matrix.flatten_2D_to_1D(PC.transposed()));

    context.uniform4fv(gpu_addresses.color, material.color);
    context.uniform4fv(gpu_addresses.specularColor, material.specularColor);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;
    in vec3 normal;
    in mat4 modelTransform_1;

    out vec3 vPos;
    out vec3 vNorm;

    uniform mat4 projection_camera_transform;

    void main() { 
      gl_Position = (projection_camera_transform * modelTransform_1) * vec4( position, 1.0 );
      vPos = (modelTransform_1 * vec4(position, 1.0)).xyz;
      vNorm = normalize(mat3(transpose(inverse(modelTransform_1))) * normal);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    layout (location = 0) out vec4 FragPosition;
    layout (location = 1) out vec4 FragNormal;
    layout (location = 2) out vec4 FragAlbedo;
    layout (location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;

    uniform vec4 color;
    uniform vec4 specularColor;

    void main() {                                                   
      FragPosition = vec4(vPos, 1.0);
      FragNormal = vec4(vNorm, 1.0);
      FragAlbedo = color;
      FragSpecular = specularColor;
    }`;
  }
}

shaders.GeometryShaderTextured = class GeometryShaderTextured extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PCM = P.times(C).times(M);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.normalMatrix, false, Matrix.flatten_2D_to_1D(Mat4.inverse(model_transform)));

    context.uniform1f(gpu_addresses.textureScale, material.textureScale);
    context.uniform1f(gpu_addresses.ambientScale, material.ambientScale);

    material.texAlbedo.activate(context, 1);
    context.uniform1i(gpu_addresses.texAlbedo, 1);
    material.texNormal.activate(context, 2);
    context.uniform1i(gpu_addresses.texNormal, 2);
    material.texARM.activate(context, 3);
    context.uniform1i(gpu_addresses.texARM, 3);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;
    in vec2 texture_coord;

    out vec3 vPos;
    out vec3 vNorm;
    out vec2 vUV;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;
    uniform mat4 normalMatrix;

    void main() { 
      gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
      vPos = (modelTransform * vec4(position, 1.0)).xyz;
      vNorm = normalize(mat3(normalMatrix) * normal);
      vUV = texture_coord;
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    layout(location = 0) out vec4 FragPosition;
    layout(location = 1) out vec4 FragNormal;
    layout(location = 2) out vec4 FragAlbedo;
    layout(location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;
    in vec2 vUV;

    uniform sampler2D texAlbedo;
    uniform sampler2D texNormal;
    uniform sampler2D texARM;

    uniform float textureScale;
    uniform float ambientScale;

    uniform vec3 cameraCenter;

    mat3 cotangent_frame(vec3 N, vec3 p, vec2 uv) {
        // get edge vectors of the pixel triangle
        vec3 dp1 = dFdx(p);
        vec3 dp2 = dFdy(p);
        vec2 duv1 = dFdx(uv);
        vec2 duv2 = dFdy(uv);

        // solve the linear system
        vec3 dp2perp = cross(dp2, N);
        vec3 dp1perp = cross(N, dp1);
        vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
        vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;

        // construct a scale-invariant frame 
        float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
        return mat3(T * invmax, B * invmax, N);
    }

    void main() {
        vec3 albedo = pow(texture(texAlbedo, vUV * textureScale).rgb, vec3(2.2));
        vec3 normal = texture(texNormal, vUV * textureScale).xyz;
        vec3 arm = texture(texARM, vUV * textureScale).xyz;
        float roughness = arm.y;
        float metalness = arm.z;
        float ao = arm.x;

        normal = normalize(cotangent_frame(normalize(vNorm), vPos, vUV) * normal.xyz);

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normal, 1.0);
        FragAlbedo = vec4(pow(albedo, vec3(2.2)), 1.0);
        FragSpecular = vec4(roughness, ao * ambientScale, 1.0, metalness);
    }
    
    `;
  }
}

shaders.GeometryShaderTexturedMinimal = class GeometryShaderTexturedMinimal extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PCM = P.times(C).times(M);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.normalMatrix, false, Matrix.flatten_2D_to_1D(Mat4.inverse(model_transform)));

    material.texAlbedo.activate(context, 1);
    context.uniform1i(gpu_addresses.texAlbedo, 1);

    context.uniform1f(gpu_addresses.metallic, material.metallic);
    context.uniform1f(gpu_addresses.roughness, material.roughness);
    context.uniform1f(gpu_addresses.ambient, material.ambient);
    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;
    in vec2 texture_coord;

    out vec3 vPos;
    out vec3 vNorm;
    out vec2 vUV;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;
    uniform mat4 normalMatrix;
    uniform float time;

    void main() { 
      gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
      vPos = (modelTransform * vec4(position, 1.0)).xyz;
      vNorm = normalize(mat3(normalMatrix) * normal);
      vUV = texture_coord;
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    layout(location = 0) out vec4 FragPosition;
    layout(location = 1) out vec4 FragNormal;
    layout(location = 2) out vec4 FragAlbedo;
    layout(location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;
    in vec2 vUV;

    uniform sampler2D texAlbedo;
    uniform float metallic;
    uniform float roughness;
    uniform float ambient;

    uniform vec3 cameraCenter;

    void main() {
        vec3 albedo = texture(texAlbedo, vUV).rgb;

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normalize(vNorm), 1.0);
        FragAlbedo = vec4(pow(albedo.xyz, vec3(2.2)), 1.0);
        FragSpecular = vec4(roughness, ambient, 1.0, metallic);
    }
    
    `;
  }
}

shaders.GeometryShaderTexturedMinimalInstanced = class GeometryShaderTexturedMinimalInstanced extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PC = P.times(C);
    context.uniformMatrix4fv(gpu_addresses.projection_camera, false, Matrix.flatten_2D_to_1D(PC.transposed()));

    material.texAlbedo.activate(context, 1);
    context.uniform1i(gpu_addresses.texAlbedo, 1);

    context.uniform1f(gpu_addresses.metallic, material.metallic);
    context.uniform1f(gpu_addresses.roughness, material.roughness);
    context.uniform1f(gpu_addresses.ambient, material.ambient);
    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;
    in vec2 texture_coord;
    in mat4 modelTransform_1;

    out vec3 vPos;
    out vec3 vNorm;
    out vec2 vUV;

    uniform mat4 projection_camera;
    uniform float time;

    void main() { 
      gl_Position = (projection_camera*modelTransform_1) * vec4( position, 1.0 );
      vPos = (modelTransform_1 * vec4(position, 1.0)).xyz;
      vNorm = normalize(mat3(transpose(inverse(modelTransform_1))) * normal);
      vUV = texture_coord;
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    layout(location = 0) out vec4 FragPosition;
    layout(location = 1) out vec4 FragNormal;
    layout(location = 2) out vec4 FragAlbedo;
    layout(location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;
    in vec2 vUV;

    uniform sampler2D texAlbedo;
    uniform float metallic;
    uniform float roughness;
    uniform float ambient;

    uniform vec3 cameraCenter;

    void main() {
        vec3 albedo = texture(texAlbedo, vUV).rgb;

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normalize(vNorm), 1.0);
        FragAlbedo = vec4(pow(albedo.xyz, vec3(2.2)), 1.0);
        FragSpecular = vec4(roughness, ambient, 1.0, metallic);
    }
    
    `;
  }
}

shaders.FishGeometryShader = class FishGeometryShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PCM = P.times(C).times(M);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.normalMatrix, false, Matrix.flatten_2D_to_1D(Mat4.inverse(model_transform)));

    material.texAlbedo.activate(context, 1);
    context.uniform1i(gpu_addresses.texAlbedo, 1);

    context.uniform1f(gpu_addresses.metallic, material.metallic);
    context.uniform1f(gpu_addresses.roughness, material.roughness);
    context.uniform1f(gpu_addresses.ambient, material.ambient);
    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
    context.uniform1f(gpu_addresses.wiggleFrequency, 1.15);
    context.uniform1f(gpu_addresses.wiggleAmplitude, 0.08);
    context.uniform1f(gpu_addresses.speed, 8.0);
    context.uniform1f(gpu_addresses.panAmplitude, 0.13);
    context.uniform1f(gpu_addresses.twistAmplitude, 0.12);
    context.uniform1f(gpu_addresses.rollAmplitude, 0.15);
    context.uniform1f(gpu_addresses.rollFrequency, 1.02);
    context.uniform1f(gpu_addresses.genAmplitude, document.getElementById("sld1").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;
    in vec2 texture_coord;

    out vec3 vPos;
    out vec3 vNorm;
    out vec2 vUV;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;
    uniform mat4 normalMatrix;
    uniform float time;
    uniform float wiggleAmplitude;
    uniform float wiggleFrequency;
    uniform float speed;
    uniform float panAmplitude;
    uniform float twistAmplitude;
    uniform float rollAmplitude;
    uniform float rollFrequency;
    uniform float genAmplitude;

    void main() { 
      vec3 pos = position;

      float genAmpTimeMult = 1.1 / (genAmplitude);

      float xRot = sin((time + 0.2) * genAmpTimeMult * speed - pow(pos.x + 3.0, rollFrequency)) * pow(pos.x + 3.0, 1.1) * rollAmplitude * genAmplitude;
      float rotCos = cos(xRot), rotSin = sin(xRot);
      mat3 xRotMat = mat3(vec3(1, 0, 0), vec3(0, rotCos, rotSin), vec3(0, -rotSin, rotCos));
      pos = xRotMat * pos;

      float yRot = sin(time * genAmpTimeMult * speed) * twistAmplitude * genAmplitude;
      rotCos = cos(yRot), rotSin = sin(yRot);
      mat3 yRotMat = mat3(vec3(rotCos, 0, -rotSin), vec3(0, 1, 0), vec3(rotSin, 0, rotCos));
      pos.x += 1.5;
      pos = yRotMat * pos;
      pos.x -= 1.5;

      pos.z += (1.0 - cos((time + 0.8) * genAmpTimeMult * speed - pow(pos.x + 3.0, wiggleFrequency))) * pow(pos.x + 3.0, 1.1) * wiggleAmplitude * genAmplitude;
      pos.z += panAmplitude * sin(speed * genAmpTimeMult * time) * genAmplitude;


      gl_Position = projection_camera_model_transform * vec4( pos, 1.0 );
      vPos = (modelTransform * vec4(pos, 1.0)).xyz;
      vNorm = normalize(mat3(normalMatrix) * normal);
      vUV = texture_coord;
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    layout(location = 0) out vec4 FragPosition;
    layout(location = 1) out vec4 FragNormal;
    layout(location = 2) out vec4 FragAlbedo;
    layout(location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;
    in vec2 vUV;

    uniform sampler2D texAlbedo;
    uniform float metallic;
    uniform float roughness;
    uniform float ambient;

    uniform vec3 cameraCenter;

    void main() {
        vec3 albedo = texture(texAlbedo, vUV).rgb;

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normalize(vNorm), 1.0);
        FragAlbedo = vec4(pow(albedo.xyz, vec3(2.2)), 1.0);
        FragSpecular = vec4(roughness, ambient, 1.0, metallic);
    }
    
    `;
  }
}

shaders.SharkGeometryShader = class SharkGeometryShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PCM = P.times(C).times(M);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.normalMatrix, false, Matrix.flatten_2D_to_1D(Mat4.inverse(model_transform)));

    material.texAlbedo.activate(context, 1);
    context.uniform1i(gpu_addresses.texAlbedo, 1);

    context.uniform1f(gpu_addresses.metallic, material.metallic);
    context.uniform1f(gpu_addresses.roughness, material.roughness);
    context.uniform1f(gpu_addresses.ambient, material.ambient);
    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
    context.uniform1f(gpu_addresses.wiggleFrequency, 1.15);
    context.uniform1f(gpu_addresses.wiggleAmplitude, 0.08);
    context.uniform1f(gpu_addresses.speed, 8.0);
    context.uniform1f(gpu_addresses.panAmplitude, 0.13);
    context.uniform1f(gpu_addresses.twistAmplitude, 0.12);
    context.uniform1f(gpu_addresses.rollAmplitude, 0.15);
    context.uniform1f(gpu_addresses.rollFrequency, 1.02);
    context.uniform1f(gpu_addresses.genAmplitude, 0.2);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;
    in vec2 texture_coord;

    out vec3 vPos;
    out vec3 vNorm;
    out vec2 vUV;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;
    uniform mat4 normalMatrix;
    uniform float time;
    uniform float wiggleAmplitude;
    uniform float wiggleFrequency;
    uniform float speed;
    uniform float panAmplitude;
    uniform float twistAmplitude;
    uniform float rollAmplitude;
    uniform float rollFrequency;
    uniform float genAmplitude;

    void main() { 
      vec3 pos = vec3(-1,1,1) * position;

      float genAmpTimeMult = 0.7;

      float xRot = sin((time + 0.2) * genAmpTimeMult * speed - pow(pos.x + 3.0, rollFrequency)) * pow(pos.x + 3.0, 1.1) * rollAmplitude * genAmplitude;
      float rotCos = cos(xRot), rotSin = sin(xRot);
      mat3 xRotMat = mat3(vec3(1, 0, 0), vec3(0, rotCos, rotSin), vec3(0, -rotSin, rotCos));
      pos = xRotMat * pos;

      float yRot = sin(time * genAmpTimeMult * speed) * twistAmplitude * genAmplitude;
      rotCos = cos(yRot), rotSin = sin(yRot);
      mat3 yRotMat = mat3(vec3(rotCos, 0, -rotSin), vec3(0, 1, 0), vec3(rotSin, 0, rotCos));
      pos.x += 1.5;
      pos = yRotMat * pos;
      pos.x -= 1.5;

      pos.z += (1.0 - cos((time + 0.8) * genAmpTimeMult * speed - pow(pos.x + 5.0, wiggleFrequency))) * pow(pos.x + 6.0, 1.1) * wiggleAmplitude * genAmplitude;
      pos.z += panAmplitude * sin(speed * genAmpTimeMult * time) * genAmplitude;


      gl_Position = projection_camera_model_transform * vec4( pos, 1.0 );
      vPos = (modelTransform * vec4(pos, 1.0)).xyz;
      vNorm = normalize(mat3(normalMatrix) * normal);
      vUV = texture_coord;
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    layout(location = 0) out vec4 FragPosition;
    layout(location = 1) out vec4 FragNormal;
    layout(location = 2) out vec4 FragAlbedo;
    layout(location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;
    in vec2 vUV;

    uniform sampler2D texAlbedo;
    uniform float metallic;
    uniform float roughness;
    uniform float ambient;

    uniform vec3 cameraCenter;

    void main() {
        vec3 albedo = texture(texAlbedo, vUV).rgb;

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normalize(vNorm), 1.0);
        FragAlbedo = vec4(pow(albedo.xyz, vec3(2.2)), 1.0);
        FragSpecular = vec4(roughness, ambient, 1.0, metallic);
    }
    
    `;
  }
}

shaders.FishGeometryShaderInstanced = class FishGeometryShaderInstanced extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PC = P.times(C);
    context.uniformMatrix4fv(gpu_addresses.projection_camera, false, Matrix.flatten_2D_to_1D(PC.transposed()));

    material.texAlbedo.activate(context, 1);
    context.uniform1i(gpu_addresses.texAlbedo, 1);

    context.uniform1f(gpu_addresses.metallic, material.metallic);
    context.uniform1f(gpu_addresses.roughness, material.roughness);
    context.uniform1f(gpu_addresses.ambient, material.ambient);
    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
    context.uniform1f(gpu_addresses.wiggleFrequency, 1.15);
    context.uniform1f(gpu_addresses.wiggleAmplitude, 0.08);
    context.uniform1f(gpu_addresses.speed, 8.0);
    context.uniform1f(gpu_addresses.panAmplitude, 0.13);
    context.uniform1f(gpu_addresses.twistAmplitude, 0.12);
    context.uniform1f(gpu_addresses.rollAmplitude, 0.15);
    context.uniform1f(gpu_addresses.rollFrequency, 1.02);
    context.uniform1f(gpu_addresses.genAmplitude, document.getElementById("sld1").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    layout (location = 0) in vec3 position;  
    layout (location = 1) in vec3 normal;
    layout (location = 2) in vec2 texture_coord;
    layout (location = 3) in mat4 modelTransform_1;

    out vec3 vPos;
    out vec3 vNorm;
    out vec2 vUV;

    uniform mat4 projection_camera;
    uniform float time;
    uniform float wiggleAmplitude;
    uniform float wiggleFrequency;
    uniform float speed;
    uniform float panAmplitude;
    uniform float twistAmplitude;
    uniform float rollAmplitude;
    uniform float rollFrequency;
    uniform float genAmplitude;

    void main() { 
      vec3 pos = position;

      float genAmpTimeMult = 1.1 / (genAmplitude);

      float xRot = sin((time + 0.2) * genAmpTimeMult * speed - pow(pos.x + 3.0, rollFrequency)) * pow(pos.x + 3.0, 1.1) * rollAmplitude * genAmplitude;
      float rotCos = cos(xRot), rotSin = sin(xRot);
      mat3 xRotMat = mat3(vec3(1, 0, 0), vec3(0, rotCos, rotSin), vec3(0, -rotSin, rotCos));
      pos = xRotMat * pos;

      float yRot = sin(time * genAmpTimeMult * speed) * twistAmplitude * genAmplitude;
      rotCos = cos(yRot), rotSin = sin(yRot);
      mat3 yRotMat = mat3(vec3(rotCos, 0, -rotSin), vec3(0, 1, 0), vec3(rotSin, 0, rotCos));
      pos.x += 1.5;
      pos = yRotMat * pos;
      pos.x -= 1.5;

      pos.z += (1.0 - cos((time + 0.8) * genAmpTimeMult * speed - pow(pos.x + 3.0, wiggleFrequency))) * pow(pos.x + 3.0, 1.1) * wiggleAmplitude * genAmplitude;
      pos.z += panAmplitude * sin(speed * genAmpTimeMult * time) * genAmplitude;


      gl_Position = (projection_camera * modelTransform_1) * vec4( pos, 1.0 );
      vPos = (modelTransform_1 * vec4(pos, 1.0)).xyz;
      vNorm = normalize(mat3(transpose(inverse(modelTransform_1))) * normal);
      vUV = texture_coord;
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    layout(location = 0) out vec4 FragPosition;
    layout(location = 1) out vec4 FragNormal;
    layout(location = 2) out vec4 FragAlbedo;
    layout(location = 3) out vec4 FragSpecular;

    in vec3 vPos;
    in vec3 vNorm;
    in vec2 vUV;

    uniform sampler2D texAlbedo;
    uniform float metallic;
    uniform float roughness;
    uniform float ambient;

    uniform vec3 cameraCenter;

    void main() {
        vec3 albedo = texture(texAlbedo, vUV).rgb;

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normalize(vNorm), 1.0);
        FragAlbedo = vec4(pow(albedo.xyz, vec3(2.2)), 1.0);
        FragSpecular = vec4(roughness, ambient, 1.0, metallic);
    }
    
    `;
  }
}

shaders.FishShadowShaderInstanced = class FishShadowShaderInstanced extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    context.uniformMatrix4fv(gpu_addresses.projView, false, Matrix.flatten_2D_to_1D(material.proj().times(material.view()).transposed()));

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
    context.uniform1f(gpu_addresses.wiggleFrequency, 1.15);
    context.uniform1f(gpu_addresses.wiggleAmplitude, 0.08);
    context.uniform1f(gpu_addresses.speed, 8.0);
    context.uniform1f(gpu_addresses.panAmplitude, 0.13);
    context.uniform1f(gpu_addresses.twistAmplitude, 0.12);
    context.uniform1f(gpu_addresses.rollAmplitude, 0.15);
    context.uniform1f(gpu_addresses.rollFrequency, 1.02);
    context.uniform1f(gpu_addresses.genAmplitude, document.getElementById("sld1").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    layout (location = 0) in vec3 position;
    layout (location = 3) in mat4 modelTransform_1;

    uniform mat4 projView;
    uniform float time;
    uniform float wiggleAmplitude;
    uniform float wiggleFrequency;
    uniform float speed;
    uniform float panAmplitude;
    uniform float twistAmplitude;
    uniform float rollAmplitude;
    uniform float rollFrequency;
    uniform float genAmplitude;

    void main() { 
      vec3 pos = position;

      float genAmpTimeMult = 1.1 / (genAmplitude);

      float xRot = sin((time + 0.2) * genAmpTimeMult * speed - pow(pos.x + 3.0, rollFrequency)) * pow(pos.x + 3.0, 1.1) * rollAmplitude * genAmplitude;
      float rotCos = cos(xRot), rotSin = sin(xRot);
      mat3 xRotMat = mat3(vec3(1, 0, 0), vec3(0, rotCos, rotSin), vec3(0, -rotSin, rotCos));
      pos = xRotMat * pos;

      float yRot = sin(time * genAmpTimeMult * speed) * twistAmplitude * genAmplitude;
      rotCos = cos(yRot), rotSin = sin(yRot);
      mat3 yRotMat = mat3(vec3(rotCos, 0, -rotSin), vec3(0, 1, 0), vec3(rotSin, 0, rotCos));
      pos.x += 1.5;
      pos = yRotMat * pos;
      pos.x -= 1.5;

      pos.z += (1.0 - cos((time + 0.8) * genAmpTimeMult * speed - pow(pos.x + 3.0, wiggleFrequency))) * pow(pos.x + 3.0, 1.1) * wiggleAmplitude * genAmplitude;
      pos.z += panAmplitude * sin(speed * genAmpTimeMult * time) * genAmplitude;


      gl_Position = (projView * modelTransform_1) * vec4( pos, 1.0 );
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    out vec4 FragColor;

    void main() {
        FragColor = vec4(1,1,1,1);
    }
    
    `;
  }
}

shaders.FishShadowShader = class FishShadowShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    context.uniformMatrix4fv(gpu_addresses.projViewCamera, false, Matrix.flatten_2D_to_1D(material.proj().times(material.view()).times(model_transform).transposed()));

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
    context.uniform1f(gpu_addresses.wiggleFrequency, 1.15);
    context.uniform1f(gpu_addresses.wiggleAmplitude, 0.08);
    context.uniform1f(gpu_addresses.speed, 8.0);
    context.uniform1f(gpu_addresses.panAmplitude, 0.13);
    context.uniform1f(gpu_addresses.twistAmplitude, 0.12);
    context.uniform1f(gpu_addresses.rollAmplitude, 0.15);
    context.uniform1f(gpu_addresses.rollFrequency, 1.02);
    context.uniform1f(gpu_addresses.genAmplitude, document.getElementById("sld1").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    uniform mat4 projViewCamera;
    uniform float time;
    uniform float wiggleAmplitude;
    uniform float wiggleFrequency;
    uniform float speed;
    uniform float panAmplitude;
    uniform float twistAmplitude;
    uniform float rollAmplitude;
    uniform float rollFrequency;
    uniform float genAmplitude;

    void main() { 
      vec3 pos = position;

      float genAmpTimeMult = 1.1 / (genAmplitude);

      float xRot = sin((time + 0.2) * genAmpTimeMult * speed - pow(pos.x + 3.0, rollFrequency)) * pow(pos.x + 3.0, 1.1) * rollAmplitude * genAmplitude;
      float rotCos = cos(xRot), rotSin = sin(xRot);
      mat3 xRotMat = mat3(vec3(1, 0, 0), vec3(0, rotCos, rotSin), vec3(0, -rotSin, rotCos));
      pos = xRotMat * pos;

      float yRot = sin(time * genAmpTimeMult * speed) * twistAmplitude * genAmplitude;
      rotCos = cos(yRot), rotSin = sin(yRot);
      mat3 yRotMat = mat3(vec3(rotCos, 0, -rotSin), vec3(0, 1, 0), vec3(rotSin, 0, rotCos));
      pos.x += 1.5;
      pos = yRotMat * pos;
      pos.x -= 1.5;

      pos.z += (1.0 - cos((time + 0.8) * genAmpTimeMult * speed - pow(pos.x + 3.0, wiggleFrequency))) * pow(pos.x + 3.0, 1.1) * wiggleAmplitude * genAmplitude;
      pos.z += panAmplitude * sin(speed * genAmpTimeMult * time) * genAmplitude;


      gl_Position = projViewCamera * vec4( pos, 1.0 );
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    out vec4 FragColor;

    void main() {
        FragColor = vec4(1,1,1,1);
    }
    
    `;
  }
}

shaders.SharkShadowShader = class SharkShadowShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    context.uniformMatrix4fv(gpu_addresses.projViewCamera, false, Matrix.flatten_2D_to_1D(material.proj().times(material.view()).times(model_transform).transposed()));

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);
    context.uniform1f(gpu_addresses.wiggleFrequency, 1.15);
    context.uniform1f(gpu_addresses.wiggleAmplitude, 0.08);
    context.uniform1f(gpu_addresses.speed, 8.0);
    context.uniform1f(gpu_addresses.panAmplitude, 0.13);
    context.uniform1f(gpu_addresses.twistAmplitude, 0.12);
    context.uniform1f(gpu_addresses.rollAmplitude, 0.15);
    context.uniform1f(gpu_addresses.rollFrequency, 1.02);
    context.uniform1f(gpu_addresses.genAmplitude, 0.2);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    uniform mat4 projViewCamera;
    uniform float time;
    uniform float wiggleAmplitude;
    uniform float wiggleFrequency;
    uniform float speed;
    uniform float panAmplitude;
    uniform float twistAmplitude;
    uniform float rollAmplitude;
    uniform float rollFrequency;
    uniform float genAmplitude;

    void main() { 
      vec3 pos = vec3(-1,1,1) * position;

      float genAmpTimeMult = 0.7;

      float xRot = sin((time + 0.2) * genAmpTimeMult * speed - pow(pos.x + 3.0, rollFrequency)) * pow(pos.x + 3.0, 1.1) * rollAmplitude * genAmplitude;
      float rotCos = cos(xRot), rotSin = sin(xRot);
      mat3 xRotMat = mat3(vec3(1, 0, 0), vec3(0, rotCos, rotSin), vec3(0, -rotSin, rotCos));
      pos = xRotMat * pos;

      float yRot = sin(time * genAmpTimeMult * speed) * twistAmplitude * genAmplitude;
      rotCos = cos(yRot), rotSin = sin(yRot);
      mat3 yRotMat = mat3(vec3(rotCos, 0, -rotSin), vec3(0, 1, 0), vec3(rotSin, 0, rotCos));
      pos.x += 1.5;
      pos = yRotMat * pos;
      pos.x -= 1.5;

      pos.z += (1.0 - cos((time + 0.8) * genAmpTimeMult * speed - pow(pos.x + 5.0, wiggleFrequency))) * pow(pos.x + 6.0, 1.1) * wiggleAmplitude * genAmplitude;
      pos.z += panAmplitude * sin(speed * genAmpTimeMult * time) * genAmplitude;


      gl_Position = projViewCamera * vec4( pos, 1.0 );
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    out vec4 FragColor;

    void main() {
        FragColor = vec4(1,1,1,1);
    }
    
    `;
  }
}

shaders.PointLightShader = class PointLightShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform]
    const PCM = P.times(C).times(M);
    const PC = P.times(C)
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));

    material.gTextures().gPosition.activate(context, 6);
    context.uniform1i(gpu_addresses.gPosition, 6);
    material.gTextures().gNormal.activate(context, 7);
    context.uniform1i(gpu_addresses.gNormal, 7);
    material.gTextures().gAlbedo.activate(context, 8);
    context.uniform1i(gpu_addresses.gAlbedo, 8);
    material.gTextures().gSpecular.activate(context, 9);
    context.uniform1i(gpu_addresses.gSpecular, 9);

    context.uniform4fv(gpu_addresses.lightPos, uniforms.pointLights[material.index].position);
    context.uniform4fv(gpu_addresses.lightColor, uniforms.pointLights[material.index].color);
    context.uniform1f(gpu_addresses.lightAtt, uniforms.pointLights[material.index].attenuation);

    context.uniform3fv(gpu_addresses.cameraCenter, uniforms.camera_transform.times(vec4(0, 0, 0, 1)).to3());
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;

    void main() { 
      gl_Position = projection_camera_model_transform * vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D gPosition;
    uniform sampler2D gNormal;
    uniform sampler2D gAlbedo;
    uniform sampler2D gSpecular;

    uniform vec3 cameraCenter;

    uniform vec4 lightPos;
    uniform vec4 lightColor;
    uniform float lightAtt;

    out vec4 FragColor;

    float DistributionGGX(vec3 N, vec3 H, float roughness){
        float a      = roughness*roughness;
        float a2     = a*a;
        float NdotH  = max(dot(N, H), 0.0);
        float NdotH2 = NdotH*NdotH;
      
        float num   = a2;
        float denom = (NdotH2 * (a2 - 1.0) + 1.0);
        denom = 3.14159265 * denom * denom;
      
        return num / denom;
    }

    float GeometrySchlickGGX(float NdotV, float roughness){
        float r = (roughness + 1.0);
        float k = (r*r) / 8.0;

        float num   = NdotV;
        float denom = NdotV * (1.0 - k) + k;
      
        return num / denom;
    }

    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness){
        float NdotV = max(dot(N, V), 0.0);
        float NdotL = max(dot(N, L), 0.0);
        float ggx2  = GeometrySchlickGGX(NdotV, roughness);
        float ggx1  = GeometrySchlickGGX(NdotL, roughness);
      
        return ggx1 * ggx2;
    }

    vec3 fresnelSchlick(float cosTheta, vec3 F0){
        return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }  

    vec3 HDR2SDR(vec3 color){
      color = color / (color + vec3(1.0));
      return pow(color, vec3(1.0/2.2));  
    }

    vec3 PBR(vec3 WorldPos, vec3 Normal, vec3 albedo, float roughness, float metallic){
      vec3 N = normalize(Normal);
      vec3 V = normalize(cameraCenter - WorldPos);

      vec3 F0 = vec3(0.04); 
      F0 = mix(F0, albedo, metallic);
              
      vec3 Lo = vec3(0.0);
      
      vec3 L = normalize(lightPos.xyz - WorldPos);
      vec3 H = normalize(V + L);
      float distance    = length(lightPos.xyz - WorldPos);
      float attenuation = 1.0 / (distance * distance);
      vec3 radiance     = lightColor.xyz * attenuation;        
      
      float NDF = DistributionGGX(N, H, roughness);        
      float G   = GeometrySmith(N, V, L, roughness);      
      vec3 F    = fresnelSchlick(max(dot(H, V), 0.0), F0);       
      
      vec3 kS = F;
      vec3 kD = vec3(1.0) - kS;
      kD *= 1.0 - metallic;	  
      
      vec3 numerator    = NDF * G * F;
      float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
      vec3 specular     = numerator / denominator;  
          
      float NdotL = max(dot(N, L), 0.0);                
      Lo += (kD * albedo / 3.14159265 + specular) * radiance * NdotL;  
    
      return Lo;
    }

    void main(){		
    ivec2 fragCoord = ivec2(gl_FragCoord.xy);
    vec3 position = texelFetch(gPosition, fragCoord, 0).xyz;
    vec3 normal = normalize(texelFetch(gNormal, fragCoord, 0).xyz);
    vec4 albedo = texelFetch(gAlbedo, fragCoord, 0);
    float metallic = texelFetch(gSpecular, fragCoord, 0).w;
    float roughness = texelFetch(gSpecular, fragCoord, 0).x;

    FragColor = vec4(PBR(position.xyz, normal.xyz, albedo.xyz, roughness, metallic), albedo.w);    
}  
    
    
    
    
    `;
  }
}

shaders.DirectionalLightShader = class DirectionalLightShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform]
    const PCM = P.times(C).times(M);
    const PC = P.times(C)
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.sunProjView, false, Matrix.flatten_2D_to_1D(material.sunProj().times(material.sunView()).transposed()));

    material.gTextures().gPosition.activate(context, 6);
    context.uniform1i(gpu_addresses.gPosition, 6);
    material.gTextures().gNormal.activate(context, 7);
    context.uniform1i(gpu_addresses.gNormal, 7);
    material.gTextures().gAlbedo.activate(context, 8);
    context.uniform1i(gpu_addresses.gAlbedo, 8);
    material.gTextures().gSpecular.activate(context, 9);
    context.uniform1i(gpu_addresses.gSpecular, 9);

    material.lightDepthTexture().activate(context, 10);
    context.uniform1i(gpu_addresses.lightDepthTexture, 10);

    context.uniform4fv(gpu_addresses.lightPos, uniforms.directionalLights[material.index].direction);
    context.uniform4fv(gpu_addresses.lightColor, uniforms.directionalLights[material.index].color);
    context.uniform1f(gpu_addresses.lightAtt, uniforms.directionalLights[material.index].attenuation);

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);

    context.uniform3fv(gpu_addresses.cameraCenter, uniforms.camera_transform.times(vec4(0, 0, 0, 1)).to3());

    context.uniform1f(gpu_addresses.slider, document.getElementById("sld2").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  
    in vec3 normal;

    uniform mat4 projection_camera_model_transform;
    uniform mat4 modelTransform;

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D gPosition;
    uniform sampler2D gNormal;
    uniform sampler2D gAlbedo;
    uniform sampler2D gSpecular;
    uniform float slider;

    uniform mat4 sunProjView;
    uniform sampler2D lightDepthTexture;
    
    uniform vec3 cameraCenter;
    uniform float time;
    
    uniform vec4 lightPos;
    uniform vec4 lightColor;
    uniform float lightAtt;
    
    out vec4 FragColor;
    
    float DistributionGGX(vec3 N, vec3 H, float roughness) {
        float a = roughness * roughness;
        float a2 = a * a;
        float NdotH = max(dot(N, H), 0.0);
        float NdotH2 = NdotH * NdotH;
    
        float num = a2;
        float denom = (NdotH2 * (a2 - 1.0) + 1.0);
        denom = 3.14159265 * denom * denom;
    
        return num / denom;
    }
    
    float GeometrySchlickGGX(float NdotV, float roughness) {
        float r = (roughness + 1.0);
        float k = (r * r) / 8.0;
    
        float num = NdotV;
        float denom = NdotV * (1.0 - k) + k;
    
        return num / denom;
    }
    
    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
        float NdotV = max(dot(N, V), 0.0);
        float NdotL = max(dot(N, L), 0.0);
        float ggx2 = GeometrySchlickGGX(NdotV, roughness);
        float ggx1 = GeometrySchlickGGX(NdotL, roughness);
    
        return ggx1 * ggx2;
    }
    
    vec3 fresnelSchlick(float cosTheta, vec3 F0) {
        return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }
    
    vec3 HDR2SDR(vec3 color) {
        vec3 c = color / (color + vec3(1.0));
        return pow(c, vec3(1.0 / 2.2));
    }
    
    vec3 PBR(vec3 WorldPos, vec3 Normal, vec3 albedo, float roughness, float metallic) {
        vec3 N = normalize(Normal);
        vec3 V = normalize(cameraCenter - WorldPos);
    
        vec3 F0 = vec3(0.04);
        F0 = mix(F0, albedo, metallic);
    
        vec3 Lo = vec3(0.0);
    
        vec3 L = normalize(lightPos.xyz);
        vec3 H = normalize(V + L);
        const float viewDist = 300.0 / 2.0;
        vec3 radiance = mix(lightColor.xyz, vec3(0, 0, 0), clamp(length(WorldPos - cameraCenter) / viewDist, 0.0, 1.0));;
    
        float NDF = DistributionGGX(N, H, roughness);
        float G = GeometrySmith(N, V, L, roughness);
        vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    
        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metallic;
    
        vec3 numerator = NDF * G * F;
        float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
        vec3 specular = numerator / denominator;
    
        float NdotL = max(dot(N, L), 0.0);
        Lo += (kD * albedo / 3.14159265 + specular) * radiance * NdotL;
    
        return Lo;
    }

    float linearDepth(float val){
        val = 2.0 * val - 1.0;
        return (2.0 * 0.5 * 150.0) / (150.0 + 0.5 - val * (150.0 - 0.5));
    }

    float PCF_shadow(vec3 lightSamplePos) {
        vec2 center = lightSamplePos.xy;
        float projected_depth = lightSamplePos.z;
        float shadow = 0.0;
        float texel_size = 1.0 / 8192.0;
        for(int x = -1; x <= 1; ++x)
        {
            for(int y = -1; y <= 1; ++y)
            {
                float light_depth_value = linearDepth(texture(lightDepthTexture, center + vec2(x, y) * texel_size).x); 
                shadow += (linearDepth(projected_depth) >= light_depth_value + 0.003 ) ? 0.8 : 0.0;
            }    
        }
        shadow /= 9.0;
        return 1.0 - shadow;
    }

    float calcShadow(vec3 position){
      vec4 lightSamplePos = sunProjView * vec4(position,1.0);
      lightSamplePos.xyz /= lightSamplePos.w; 
      lightSamplePos.xyz *= 0.5;
      lightSamplePos.xyz += 0.5;

      bool inRange =
        lightSamplePos.x >= 0.0 &&
        lightSamplePos.x <= 1.0 &&
        lightSamplePos.y >= 0.0 &&
        lightSamplePos.y <= 1.0 &&
        lightSamplePos.z < 1.0;
     
      return inRange ? PCF_shadow(lightSamplePos.xyz) : 1.0;
    }

    void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        vec3 position = texelFetch(gPosition, fragCoord, 0).xyz;
        vec3 normal = normalize(texelFetch(gNormal, fragCoord, 0).xyz);
        vec4 albedo = texelFetch(gAlbedo, fragCoord, 0);
        float metallic = texelFetch(gSpecular, fragCoord, 0).w;
        float roughness = texelFetch(gSpecular, fragCoord, 0).x;
    
        vec3 finColor = PBR(position.xyz, normal.xyz, albedo.xyz, roughness, metallic);
        finColor *= calcShadow(position);

        FragColor = vec4(finColor, albedo.w);
    }
    
    `;
  }
}

shaders.AmbientLightShader = class AmbientLightShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform]
    const PCM = P.times(C).times(M);
    const PC = P.times(C)
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));

    material.gTextures().gPosition.activate(context, 6);
    context.uniform1i(gpu_addresses.gPosition, 6);
    material.gTextures().gNormal.activate(context, 7);
    context.uniform1i(gpu_addresses.gNormal, 7);
    material.gTextures().gAlbedo.activate(context, 8);
    context.uniform1i(gpu_addresses.gAlbedo, 8);
    material.gTextures().gSpecular.activate(context, 9);
    context.uniform1i(gpu_addresses.gSpecular, 9);

    material.cTextures().cIrradiance.activate(context, 10);
    context.uniform1i(gpu_addresses.cIrradiance, 10);

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);

    context.uniform3fv(gpu_addresses.cameraCenter, uniforms.camera_transform.times(vec4(0, 0, 0, 1)).to3());
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D gPosition;
    uniform sampler2D gNormal;
    uniform sampler2D gAlbedo;
    uniform sampler2D gSpecular;
    uniform samplerCube cIrradiance;

    uniform vec3 cameraCenter;
    

    out vec4 FragColor;

    vec3 fresnelSchlick(float cosTheta, vec3 F0, float roughness){
      return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }  

    void main(){		
      ivec2 fragCoord = ivec2(gl_FragCoord.xy);
      vec3 position = texelFetch(gPosition, fragCoord, 0).xyz;
      vec3 normal = normalize(texelFetch(gNormal, fragCoord, 0).xyz);
      vec4 albedo = texelFetch(gAlbedo, fragCoord, 0);
      vec4 spec = texelFetch(gSpecular, fragCoord, 0);
      float metallic = spec.w;
      float roughness = spec.x;
      float ao = spec.y;
      float ambientMult = spec.z;

      vec3 F0 = vec3(0.04);
      F0 = mix(F0, albedo.xyz, metallic);
      vec3 kS = fresnelSchlick(max(dot(normal, position - cameraCenter), 0.0), F0, roughness);
      vec3 kD = vec3(1.0) - kS;
      kD *= 1.0 - metallic;
      vec3 irradiance = texture(cIrradiance, normal).xyz;
      vec3 diffuse = irradiance * albedo.xyz;
      vec3 ambient = (kD * diffuse) * ao;

      FragColor = vec4(ambient, albedo.w);
    }  
    `;
  }
}

shaders.CubemapShader = class CubemapShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    context.uniformMatrix4fv(gpu_addresses.projectionCameraMatrix, false, Matrix.flatten_2D_to_1D((material.projTransform.times(material.cameraInverse)).transposed()));

    material.texture.activate(context, 6);
    context.uniform1i(gpu_addresses.tex, 6);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    out vec3 vPos;

    uniform mat4 projectionCameraMatrix;

    void main() { 
      vPos = position;
      gl_Position = projectionCameraMatrix * vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D tex;

    in vec3 vPos;

    out vec4 FragColor;

    const vec2 invAtan = vec2(0.1591, 0.3183);

    vec2 sampleSphericalMap(vec3 v){
      vec2 uv = vec2(atan(v.z, v.x), asin(v.y));
      uv *= invAtan;
      return uv + vec2(0.5);
    }

    void main(){		
      vec2 uv = sampleSphericalMap(normalize(vPos));
      vec3 color = texture(tex, uv).xyz;

      const float gamma = 2.2;
      vec3 mapped = vec3(1.0) - exp(-color * 1.0);
      mapped = pow(mapped, vec3(1.0 / gamma));

      FragColor = vec4(mapped, 1.0);
    }
    `;
  }
}

shaders.ConvolveShader = class ConvolveShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    context.uniformMatrix4fv(gpu_addresses.projectionCameraMatrix, false, Matrix.flatten_2D_to_1D((material.projTransform.times(material.cameraInverse)).transposed()));

    material.envMap.activate(context, 6);
    context.uniform1i(gpu_addresses.envMap, 6);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    out vec3 vPos;

    uniform mat4 projectionCameraMatrix;

    void main() { 
      vPos = position;
      gl_Position = projectionCameraMatrix * vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
    in vec3 vPos;

    out vec4 FragColor;

    uniform samplerCube envMap;

    const float PI = 3.14159265359;

    void main(){		
        vec3 normal = normalize(vPos);
      
        vec3 irradiance = vec3(0.0);
      
        vec3 up    = vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(up, normal));
        up         = normalize(cross(normal, right));

        float sampleDelta = 0.025;
        float nrSamples = 0.0; 
        for(float phi = 0.0; phi < 2.0 * PI; phi += sampleDelta) {
            for(float theta = 0.0; theta < 0.5 * PI; theta += sampleDelta){
                vec3 tangentSample = vec3(sin(theta) * cos(phi),  sin(theta) * sin(phi), cos(theta));
                vec3 sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * normal; 

                irradiance += texture(envMap, sampleVec).rgb * cos(theta) * sin(theta);
                nrSamples++;
            }
        }
        irradiance = PI * irradiance * (1.0 / float(nrSamples));
      
        FragColor = vec4(irradiance, 1.0);
    }
    `;
  }
}

shaders.CopyToDefaultFB = class CopyToDefaultFB extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {

    context.uniformMatrix4fv(gpu_addresses.projViewInverse, false, Matrix.flatten_2D_to_1D(Mat4.inverse(uniforms.projection_transform.times(uniforms.camera_inverse)).transposed()));

    material.basic().activate(context, 6);
    context.uniform1i(gpu_addresses.lAlbedo, 6);
    material.post().activate(context, 7);
    context.uniform1i(gpu_addresses.postProcess, 7);
    material.depth().activate(context, 8);
    context.uniform1i(gpu_addresses.depth, 8);

    context.uniform1f(gpu_addresses.exposure, material.exposure);

    context.uniform1f(gpu_addresses.slider, document.getElementById('sld3').value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D lAlbedo;
    uniform sampler2D postProcess;
    uniform sampler2D depth;
    uniform float exposure;
    uniform float slider;

    out vec4 FragColor;

    float linearDepth(float val){
        val = 2.0 * val - 1.0;
        return (2.0 * 0.5 * 150.0) / (150.0 + 0.5 - val * (150.0 - 0.5));
    }

    // from https://newbedev.com/from-rgb-to-hsv-in-opengl-glsl
    vec3 rgb2hsv(vec3 c){
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    // from https://newbedev.com/from-rgb-to-hsv-in-opengl-glsl
    vec3 hsv2rgb(vec3 c){
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main(){		
      vec3 color = texelFetch(lAlbedo, ivec2(gl_FragCoord.xy), 0).xyz;
      color += texelFetch(postProcess, ivec2(gl_FragCoord.xy), 0).xyz;

      float depth = texelFetch(depth, ivec2(gl_FragCoord.xy), 0).x;

      const float gamma = 2.2;

      //hsv tonemapping
      color = rgb2hsv(color);
      color.y *= 1.4;
      color.z *= 1.4;
      color = hsv2rgb(color);
    
      // exposure tone mapping
      vec3 mapped = vec3(1.0) - exp(-color * exposure);

      // gamma correction 
      mapped = pow(mapped, vec3(1.0 / gamma));
    
      FragColor = vec4(mapped, 1.0);
    }
    `;
  }
}

shaders.CopyBright = class CopyBright extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    material.lTextures().lAlbedo.activate(context, 6);
    context.uniform1i(gpu_addresses.lAlbedo, 6);

    context.uniform1f(gpu_addresses.threshold, material.threshold);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D lAlbedo;
    uniform float threshold;

    out vec4 FragColor;

    void main(){		
      vec3 albedo = texelFetch(lAlbedo, ivec2(gl_FragCoord.xy), 0).xyz;
      
      vec3 color = vec3(0.0);
      float brightness = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
      if (brightness > threshold){
        color = albedo;
      }
    
      FragColor = vec4(color, 1.0);
    }
    `;
  }
}

shaders.GBlur = class GBlur extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    material.from().activate(context, 6);
    context.uniform1i(gpu_addresses.image, 6);

    context.uniform1i(gpu_addresses.horizontal, material.horizontal);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D image;
    uniform bool horizontal;

    out vec4 FragColor;

    void main(){
      float weight[5] = float[] (0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
      ivec2 texCoords = ivec2(gl_FragCoord.xy);
      vec3 color = texelFetch(image, texCoords, 0).xyz * weight[0];
      vec3 col = texelFetch(image, texCoords, 0).xyz;
      
      if(horizontal){
        for(int i = 1; i < 5; ++i){
          color += texelFetch(image, texCoords + ivec2(i, 0), 0).rgb * weight[i];
          color += texelFetch(image, texCoords - ivec2(i, 0), 0).rgb * weight[i];
        }
      }
      else{
        for(int i = 1; i < 5; ++i){
          color += texelFetch(image, texCoords + ivec2(0, i), 0).rgb * weight[i];
          color += texelFetch(image, texCoords - ivec2(0, i), 0).rgb * weight[i];
        }
      }
    
      FragColor = vec4(color, 1.0);
    }
    `;
  }
}

shaders.ShadowShaderBase = class ShadowShaderBase extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    context.uniformMatrix4fv(gpu_addresses.projViewCamera, false, Matrix.flatten_2D_to_1D(material.proj().times(material.view()).times(model_transform).transposed()));
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    uniform mat4 projViewCamera;

    void main() { 
      gl_Position = projViewCamera * vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    out vec4 FragColor;

    void main(){
      FragColor = vec4(1,1,1,1);
    }
    `;
  }
}

shaders.VolumetricShader = class VolumetricShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform]
    context.uniformMatrix4fv(gpu_addresses.projViewInverse, false, Matrix.flatten_2D_to_1D(Mat4.inverse(P.times(C)).transposed()));
    context.uniformMatrix4fv(gpu_addresses.sunProjView, false, Matrix.flatten_2D_to_1D(material.sunProj().times(material.sunView()).transposed()));
    context.uniformMatrix4fv(gpu_addresses.sunProjViewOrig, false, Matrix.flatten_2D_to_1D(material.sunProj().times(material.sunViewOrig()).transposed()));
    context.uniformMatrix4fv(gpu_addresses.projView, false, Matrix.flatten_2D_to_1D(P.times(C).transposed()));

    material.caustics.activate(context, 7);
    context.uniform1i(gpu_addresses.caustics, 7);

    material.pGen2().activate(context, 8);
    context.uniform1i(gpu_addresses.lAlbedo, 8);
    material.lTextures().lDepth.activate(context, 9);
    context.uniform1i(gpu_addresses.lDepth, 9);
    material.lightDepthTexture().activate(context, 10);
    context.uniform1i(gpu_addresses.lightDepthTexture, 10);

    context.uniform4fv(gpu_addresses.lightPos, uniforms.directionalLights[0].direction);
    context.uniform4fv(gpu_addresses.lightColor, uniforms.directionalLights[0].color);
    context.uniform1f(gpu_addresses.lightAtt, uniforms.directionalLights[0].attenuation);

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);

    context.uniform3fv(gpu_addresses.cameraCenter, uniforms.camera_transform.times(vec4(0, 0, 0, 1)).to3());

    context.uniform1f(gpu_addresses.slider, document.getElementById("sld2").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D lAlbedo;
    uniform sampler2D lDepth;
    uniform float slider;

    uniform mat4 projViewInverse;
    uniform mat4 sunProjView;
    uniform mat4 sunProjViewOrig;
    uniform sampler2D lightDepthTexture;

    uniform sampler2D caustics;
    
    uniform vec3 cameraCenter;
    uniform float time;
    
    uniform vec4 lightPos;
    uniform vec4 lightColor;
    
    out vec4 FragColor;

    float linearDepth(float val){
        val = 2.0 * val - 1.0;
        return (2.0 * 0.5 * 150.0) / (150.0 + 0.5 - val * (150.0 - 0.5));
    }

    float calcShadow(vec3 position){
      vec4 lightSamplePos = sunProjView * vec4(position,1.0);
      lightSamplePos.xyz /= lightSamplePos.w; 
      lightSamplePos.xyz *= 0.5;
      lightSamplePos.xyz += 0.5;

      vec4 lightSamplePosCaustic = sunProjViewOrig * vec4(position,1.0);
      lightSamplePosCaustic.xyz /= lightSamplePos.w; 
      lightSamplePosCaustic.xyz *= 0.5;
      lightSamplePosCaustic.xyz += 0.5;

      bool inRange =
        lightSamplePos.x >= 0.0 &&
        lightSamplePos.x <= 1.0 &&
        lightSamplePos.y >= 0.0 &&
        lightSamplePos.y <= 1.0 &&
        lightSamplePos.z < 1.0;

      float caustic1 = max((1.0 / (texture(caustics, time / 15.0 + lightSamplePosCaustic.xy * 25.0).x * 1.0)) - 3.8, 0.0);
      float caustic2 = max((1.0 / (texture(caustics, time / 13.0 - lightSamplePosCaustic.xy * 25.0).x * 1.0)) - 3.8, 0.0);
      float caustic = max(min(caustic1, caustic2), 0.0);
      caustic = mix(caustic, 1.0, clamp(abs(position.y/ 60.0), 0.0, 1.0));

      float lightDepth = linearDepth(texture(lightDepthTexture, lightSamplePos.xy).x);
      float sceneDepth = linearDepth(lightSamplePos.z);
      float shadow = sceneDepth > lightDepth ? 0.0 : 1.0 * caustic;
     
      return inRange ? shadow : 0.0;
    }
    
    float mieScattering(float lDotv, float g){
        float result = 1.0 - g * g;
        result /= (4.0 * 3.1415926535 * pow(1.0 + g * g - (2.0 * g) * lDotv, 1.5));
        return result;
    }

    vec4 calculateVolumetricFog(vec3 position, int steps){
        vec3 ray = position - cameraCenter;
        vec3 rayDir = normalize(ray);
        float stepSize = min(length(ray), 150.0) / float(steps);
        vec3 step = rayDir * stepSize;
        const mat4 dither = mat4
          (vec4(0.0f, 0.5f, 0.125f, 0.625f),
          vec4(0.75f, 0.22f, 0.875f, 0.375f),
          vec4(0.1875f, 0.6875f, 0.0625f, 0.5625f),
          vec4(0.9375f, 0.4375f, 0.8125f, 0.3125f));
        vec3 pos = cameraCenter + step * dither[int(gl_FragCoord.x)%4][int(gl_FragCoord.y)%4];
        vec3 lightDir = normalize(lightPos.xyz);

        vec3 fog = vec3(0.0);
        float totalDensity = 0.0;
        float density = 0.025;
        for (int i = 0; i < steps; i++){
          
          float stepDensity = density * stepSize;
          float transmittance = min(exp(-totalDensity), 1.0);
          vec3 lightCol = pow(vec3(0.944, 0.984, 0.991), max(vec3(20.0 - pos.y), 0.0) + 15.0) * lightColor.xyz;
          float gFactor = mix(-slider, -1.0, clamp(abs(pos.y)/80.0, 0.0, 1.0));
          if (pos.y > 20.0) gFactor = -1.0;
          fog += min(vec3(mieScattering(dot(rayDir, -lightDir), gFactor)) * lightCol * calcShadow(pos) * stepDensity * transmittance, 1.0/float(steps));

          totalDensity += stepDensity;

          pos += step;
        }

        return vec4(fog, 1.0 - min(exp(-totalDensity), 1.0)) ;/// float(steps);
    }

    vec3 worldFromDepth(float depth){
        vec4 clipSpace = vec4((gl_FragCoord.x/1920.0) * 2.0 - 1.0, (gl_FragCoord.y/1080.0) * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 worldspace = projViewInverse * clipSpace;
        worldspace.xyz /= worldspace.w;

        return worldspace.xyz;
    }

    void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        vec3 position = worldFromDepth(texelFetch(lDepth, fragCoord, 0).x);
        vec3 albedo = texelFetch(lAlbedo, fragCoord, 0).xyz;

        vec4 fog = calculateVolumetricFog(position, 25);

        FragColor = vec4(fog.xyz, 1.0);
    }
    `;
  }
}

shaders.DepthFogShader = class DepthFogShader extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform]
    context.uniformMatrix4fv(gpu_addresses.projViewInverse, false, Matrix.flatten_2D_to_1D(Mat4.inverse(P.times(C)).transposed()));

    material.lTextures().lAlbedo.activate(context, 8);
    context.uniform1i(gpu_addresses.lAlbedo, 8);
    material.lTextures().lDepth.activate(context, 9);
    context.uniform1i(gpu_addresses.lDepth, 9);

    context.uniform1f(gpu_addresses.time, uniforms.animation_time / 1000);

    context.uniform3fv(gpu_addresses.cameraCenter, uniforms.camera_transform.times(vec4(0, 0, 0, 1)).to3());

    context.uniform1f(gpu_addresses.slider, document.getElementById("sld2").value);
  }

  shared_glsl_code() {
    return `#version 300 es
    precision highp float;
`;
  }

  vertex_glsl_code() {
    return this.shared_glsl_code() + `
    
    in vec3 position;  

    void main() { 
      gl_Position = vec4(position, 1.0);
    }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `

    uniform sampler2D lAlbedo;
    uniform sampler2D lDepth;
    uniform float slider;

    uniform mat4 projViewInverse;
    
    uniform vec3 cameraCenter;
    uniform float time;
    
    out vec4 FragColor;

    float linearDepth(float val){
        val = 2.0 * val - 1.0;
        return (2.0 * 0.5 * 150.0) / (150.0 + 0.5 - val * (150.0 - 0.5));
    }
    
    float mieScattering(float lDotv, float g){
        float result = 1.0 - g * g;
        result /= (4.0 * 3.1415926535 * pow(1.0 + g * g - (2.0 * g) * lDotv, 1.5));
        return result;
    }

    vec3 worldFromDepth(float depth){
        vec4 clipSpace = vec4((gl_FragCoord.x/1920.0) * 2.0 - 1.0, (gl_FragCoord.y/1080.0) * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 worldspace = projViewInverse * clipSpace;
        worldspace.xyz /= worldspace.w;

        return worldspace.xyz;
    }

    void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        vec3 position = worldFromDepth(texelFetch(lDepth, fragCoord, 0).x);
        vec3 albedo = texelFetch(lAlbedo, fragCoord, 0).xyz;

        float viewDist = 300.0;
        vec3 fog = mix(albedo, vec3(.09, 0.195, 0.33)  /2.0, clamp(length(position - cameraCenter) / viewDist, 0.0, 1.0));

        FragColor = vec4(fog, 1.0);
    }
    `;
  }
}

/*
http://www.alexandre-pestana.com/volumetric-lights/
https://andrew-pham.blog/2019/10/03/volumetric-lighting/
https://support.agi32.com/support/solutions/articles/22000205309-transmission-of-light-through-water
*/