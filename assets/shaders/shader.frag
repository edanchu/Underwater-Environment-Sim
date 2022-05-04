#version 300 es
precision highp float;
uniform sampler2D gPosition;
uniform sampler2D gNormal;
uniform sampler2D gAlbedo;
uniform sampler2D gSpecular;

uniform vec3 cameraCenter;

out vec4 FragColor;

void main() {
    ivec2 fragCoord = ivec2(gl_FragCoord.xy);
    vec3 position = texelFetch(gPosition, fragCoord, 0).xyz;
    vec3 normal = normalize(texelFetch(gNormal, fragCoord, 0).xyz);
    vec4 albedo = texelFetch(gAlbedo, fragCoord, 0);
    vec4 spec = texelFetch(gSpecular, fragCoord, 0);
    float metallic = spec.x;
    float roughness = spec.w;
    float ao = spec.y;
    float ambient = spec.z;

    FragColor = vec4(albedo.xyz * ao * ambient, albedo.w);
}