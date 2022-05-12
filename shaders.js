import { tiny } from './tiny-graphics.js'
import { math } from './tiny-graphics-math.js'

const { Vector, Vector3, vec3, vec4, Mat4, Matrix } = math;

export const shaders = {};

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

      uniform mat4 projection_camera_transform;
      uniform mat4 modelTransform;
      uniform mat4 viewMatrix;
      uniform vec3 cameraCenter;
      uniform float planeSize;

      out vec3 vertexWorldspace;
      out vec2 texCoord;

      void main() { 
        vec3 p = (modelTransform * vec4(position, 1.0)).xyz;

        gl_Position = projection_camera_transform * vec4( p, 1.0 );
        vertexWorldspace = p; 
        texCoord = texture_coord + vec2(cameraCenter.x, -cameraCenter.z) / planeSize;
      }`;
  }

  fragment_glsl_code() {
    return this.shared_glsl_code() + `
      out vec4 FragColor;

      uniform sampler2D waterFlow;
      uniform sampler2D waterDerivativeHeight;
      uniform float time;
      uniform vec4 color;
      uniform vec3 cameraCenter;

      in vec3 vertexWorldspace;
      in vec2 texCoord;

      vec3 GerstnerWave (vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal, float timeOffset) {
        float steepness = wave.z;
        float wavelength = wave.w;
        float k = 2.0 * 3.141592653589 / wavelength;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(wave.xy);
        float f = k * (dot(d, p.xz) - c * time / timeOffset);
        float a = steepness / k;
    
        tangent += vec3(
            -d.x * d.x * (steepness * sin(f)),
            d.x * (steepness * cos(f)),
            -d.x * d.y * (steepness * sin(f)));
        binormal += vec3(
            -d.x * d.y * (steepness * sin(f)),
            d.y * (steepness * cos(f)),
            -d.y * d.y * (steepness * sin(f)));
        return vec3(
            d.x * (a * cos(f)),
            a * sin(f),
            d.y * (a * cos(f)));
      }

      float ease(float x){
        return sqrt(1.0 - pow(x - 1.0, 2.0));
        // return sin((x * 3.14159) / 2.0);
        // return 1.0 - pow(1.0 - x, 3.0);
      }

      vec3 generateWaves(vec3 pos, inout vec3 tan, inout vec3 bin){
        vec2 dir;
        vec3 p = pos;
        float initSteepness = 0.18, initFrequency = 15.0, initSpeed = 3.2;
        float endSteepness = 0.1, endFrequency = 1.0, endSpeed = 1.8;
        float steepness, frequency, speed;
        const float iterations = 25.0;
        float x, roc = 1.0;
        for (float i = 0.0; i < iterations; i++){
          dir = vec2(sin(i / roc), cos(i / roc));
          x = i/iterations;
          steepness = mix(initSteepness, endSteepness, ease(x));
          frequency = mix(initFrequency, endFrequency, ease(x));
          speed = mix(initSpeed, endSpeed, ease(x));
          p += GerstnerWave(vec4(dir, steepness, frequency), pos, tan, bin, speed);
        }
        return p;
      }

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
        vec3 normal = tbn * normalize(vec3(-(dhA.xy + dhB.xy), 1.0));
        
        vec3 viewDir = normalize(vertexWorldspace - cameraCenter);
        float angle = acos(dot(viewDir, normal));
        float limit = mix(0.0, 0.82, 1.0 - min((abs(cameraCenter.y - vertexWorldspace.y))/200.0, 1.0));
        // limit = mix(limit, 0.0, clamp(length(vertexWorldspace.xz - cameraCenter.xz)/80.0, 0.0, 1.0));
        vec3 waterColor = color.xyz;
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

shaders.GeometryShaderTextured = class GeometryShaderTextured extends tiny.Shader {
  update_GPU(context, gpu_addresses, uniforms, model_transform, material) {
    const [P, C, M] = [uniforms.projection_transform, uniforms.camera_inverse, model_transform], PCM = P.times(C).times(M);
    context.uniformMatrix4fv(gpu_addresses.projection_camera_model_transform, false, Matrix.flatten_2D_to_1D(PCM.transposed()));
    context.uniformMatrix4fv(gpu_addresses.modelTransform, false, Matrix.flatten_2D_to_1D(model_transform.transposed()));
    context.uniformMatrix4fv(gpu_addresses.normalMatrix, false, Matrix.flatten_2D_to_1D(Mat4.inverse(model_transform)));

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
        vec3 albedo = pow(texture(texAlbedo, vUV).rgb, vec3(2.2));
        vec3 normal = texture(texNormal, vUV).xyz;
        vec3 arm = texture(texARM, vUV).xyz;
        float roughness = arm.y;
        float metalness = arm.z;
        float ao = arm.x;

        normal = normalize(cotangent_frame(normalize(vNorm), vPos, vUV) * normal.xyz);

        FragPosition = vec4(vPos, 1.0);
        FragNormal = vec4(normal, 1.0);
        FragAlbedo = vec4(albedo, 1.0);
        FragSpecular = vec4(roughness, ao, 1.0, metalness);
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

    context.uniform4fv(gpu_addresses.lightPos, uniforms.directionalLights[material.index].position);
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
        vec3 radiance = lightColor.xyz;
    
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
        float texel_size = 1.0 / 2048.0;
        for(int x = -1; x <= 1; ++x)
        {
            for(int y = -1; y <= 1; ++y)
            {
                float light_depth_value = linearDepth(texture(lightDepthTexture, center + vec2(x, y) * texel_size).x); 
                shadow += (linearDepth(projected_depth) >= light_depth_value + 0.5 ) ? 0.8 : 0.0;
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
    
    float mieScattering(float lDotv, float g){
        float result = 1.0 - g * g;
        result /= (4.0 * 3.1415926535 * pow(1.0 + g * g - (2.0 * g) * lDotv, 1.5));
        return result;
    }

    vec3 calculateVolumetricFog(vec3 position, int steps){
        vec3 ray = position - cameraCenter;
        vec3 rayDir = normalize(ray);
        float stepSize = length(ray) / float(steps);
        vec3 step = rayDir * stepSize;
        const mat4 dither = mat4
          (vec4(0.0f, 0.5f, 0.125f, 0.625f),
          vec4(0.75f, 0.22f, 0.875f, 0.375f),
          vec4(0.1875f, 0.6875f, 0.0625f, 0.5625f),
          vec4(0.9375f, 0.4375f, 0.8125f, 0.3125f));
        vec3 pos = cameraCenter + step * dither[int(gl_FragCoord.x)%4][int(gl_FragCoord.y)%4];
        vec3 lightDir = normalize(lightPos.xyz);

        vec3 fog = vec3(0.0);

        for (int i = 0; i < steps; i++){
          vec4 posCameraSpace = sunProjView * vec4(pos,1.0);
          posCameraSpace.xyz /= posCameraSpace.w;
          posCameraSpace = posCameraSpace * 0.5 + 0.5;
          float depthCameraView = linearDepth(texture(lightDepthTexture, posCameraSpace.xy).x);
          if (depthCameraView >= linearDepth(posCameraSpace.z)){
            fog += vec3(mieScattering(min(dot(-rayDir, lightDir), 0.3), 0.5)) * lightColor.xyz;
          }
          pos += step;
        }

        return length(fog) > 0.0 ? fog / float(steps): vec3(0.0);
    }

    void main() {
        ivec2 fragCoord = ivec2(gl_FragCoord.xy);
        vec3 position = texelFetch(gPosition, fragCoord, 0).xyz;
        vec3 normal = normalize(texelFetch(gNormal, fragCoord, 0).xyz);
        vec4 albedo = texelFetch(gAlbedo, fragCoord, 0);
        float metallic = texelFetch(gSpecular, fragCoord, 0).w;
        float roughness = texelFetch(gSpecular, fragCoord, 0).x;
    
        vec3 finColor = PBR(position.xyz, normal.xyz, albedo.xyz, roughness, metallic);
        // finColor *= calculateVolumetricFog(position, 15);
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
    material.basic().activate(context, 6);
    context.uniform1i(gpu_addresses.lAlbedo, 6);
    material.post().activate(context, 7);
    context.uniform1i(gpu_addresses.postProcess, 7);

    context.uniform1f(gpu_addresses.exposure, material.exposure);
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
    uniform float exposure;

    out vec4 FragColor;

    void main(){		
      vec3 color = texelFetch(lAlbedo, ivec2(gl_FragCoord.xy), 0).xyz;
      color += texelFetch(postProcess, ivec2(gl_FragCoord.xy), 0).xyz;

      const float gamma = 2.2;
    
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

/*
http://www.alexandre-pestana.com/volumetric-lights/
https://andrew-pham.blog/2019/10/03/volumetric-lighting/
*/