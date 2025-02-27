import { load } from '@loaders.gl/core'
import { OBJLoader } from '@loaders.gl/obj'
import { luma, ShaderUniformType, UniformStore } from '@luma.gl/core'
import { AnimationLoopTemplate, AnimationProps, GPUGeometry, KeyFrames, makeAnimationLoop, Model, ModelNode, Timeline } from '@luma.gl/engine'
import { webgl2Adapter } from '@luma.gl/webgl'
import { Matrix4, Vector3 } from '@math.gl/core'

import { icoSphereFlat } from './icoSphereFlat'

import './style.css'

const vs = `\
  #version 300 es

  uniform appUniforms {
    mat4 modelViewMatrix;
    mat4 projectionMatrix;
  } app;

  in vec3 position;
  in vec3 normal;

  out vec3 vVertex;
  out vec3 vNormal;

  void main() {
    vec4 viewSpaceVertexPosition = app.modelViewMatrix * vec4(position, 1.0);

    vVertex = vec3(viewSpaceVertexPosition);
    vNormal = vec3(app.modelViewMatrix * vec4(normal, 0.0));

    gl_Position = app.projectionMatrix * viewSpaceVertexPosition;
  }
`

const fs = `\
  #version 300 es

  precision highp float;

  uniform lightingUniforms {
    vec3 lightPosition;
  } lighting;

  in vec3 vVertex;
  in vec3 vNormal;

  out vec4 fragColor;

  void main() {
    // Assumes that the light position is given in camera space, same as vVertex.
    vec3 toLight = normalize(lighting.lightPosition - vVertex);
    float cosAngle = dot(normalize(vNormal), toLight);
    cosAngle = clamp(cosAngle, 0.0, 1.0);

    fragColor = vec4(vec3(cosAngle) * vec3(0.9, 1.0, 1.0), 1.0);
  }
`

type AppUniforms = {
  modelViewMatrix: Matrix4
  projectionMatrix: Matrix4
}

type LightingUniforms = {
  lightPosition: Vector3
}

const app: { uniformTypes: Record<keyof AppUniforms, ShaderUniformType> } = {
  uniformTypes: {
    modelViewMatrix: 'mat4x4<f32>',
    projectionMatrix: 'mat4x4<f32>',
  }
}

const lighting: { uniformTypes: Record<keyof LightingUniforms, ShaderUniformType> } = {
  uniformTypes: {
    lightPosition: 'vec3<f32>',
  }
}

const eyePosition = [0, 1, 4]
const lightPosition = [-2, 3, 4]

class MyAnimationLoopTemplate extends AnimationLoopTemplate {
  viewMatrix = new Matrix4().lookAt({ eye: eyePosition })
  projectionMatrix = new Matrix4()

  uniformStore = new UniformStore<{ app: AppUniforms, lighting: LightingUniforms }>({ app, lighting })

  modelNode?: ModelNode
  rotationKeyFrames: KeyFrames<number>

  constructor({ animationLoop }: AnimationProps) {
    super()

    // Set light position in view space. We do this once because we assume the camera doesn't move.
    this.uniformStore.setUniforms({
      lighting: {
        lightPosition: new Vector3(this.viewMatrix.transformAsPoint(lightPosition)),
      },
    })

    const rotationKeyFrameData: [number, number][] = [
      [0, 0],
      [5000, 2 * Math.PI],
    ]

    const timeline = new Timeline()

    this.rotationKeyFrames = new KeyFrames(rotationKeyFrameData)
    const rotationChannel = timeline.addChannel({ duration: 5000, repeat: Number.POSITIVE_INFINITY })
    timeline.attachAnimation(this.rotationKeyFrames, rotationChannel)

    animationLoop
      .attachTimeline(timeline)
      .play()
  }

  override async onInitialize({ device }: AnimationProps) {
    // const data = await load('/icosphere-flat.obj', OBJLoader)
    // console.info('loaded data: %o', data)

    const mesh = icoSphereFlat

    const vertexData = new Float32Array(
      mesh.faces.flatMap(([i, j]) => [...mesh.vertices[i - 1], ...mesh.normals[j - 1]])
    )

    const vertexDataBuffer = device.createBuffer(vertexData)

    const geometry = new GPUGeometry({
      topology: 'triangle-list',
      vertexCount: mesh.faces.length,
      bufferLayout: [
        {
          name: 'vertexData',
          byteStride: 24,
          attributes: [
            { attribute: 'position', format: 'float32x3', byteOffset: 0 },
            { attribute: 'normal', format: 'float32x3', byteOffset: 12 },
          ]
        }
      ],
      attributes: {
        vertexData: vertexDataBuffer,
      },
    })

    const model = new Model(device, {
      vs,
      fs,
      geometry,

      // Describe where uniforms come from:
      bindings: {
        app: this.uniformStore.getManagedUniformBuffer(device, 'app'),
        lighting: this.uniformStore.getManagedUniformBuffer(device, 'lighting'),
      },

      parameters: {
        cullMode: 'back',
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      }
    })

    this.modelNode = new ModelNode({
      model,
      managedResources: [vertexDataBuffer],
    })
  }

  override onFinalize(_: AnimationProps) {
    this.modelNode?.destroy()
    this.uniformStore.destroy()
  }

  override onRender({ device, aspect }: AnimationProps) {
    const startRotation = this.rotationKeyFrames.getStartData()
    const endRotation = this.rotationKeyFrames.getEndData()
    const rotation = startRotation + this.rotationKeyFrames.factor * (endRotation - startRotation)

    const modelViewMatrix = new Matrix4(this.viewMatrix).rotateY(rotation)
    this.projectionMatrix.perspective({ fovy: Math.PI / 3, aspect })

    this.uniformStore.setUniforms({
      app: {
        modelViewMatrix,
        projectionMatrix: this.projectionMatrix,
      },
    })

    const renderPass = device.beginRenderPass({ clearColor: [1, 1, 1, 1] })
    this.modelNode?.draw(renderPass)
    renderPass.end()
  }
}

const device = luma.createDevice({
  type: 'webgl',
  adapters: [webgl2Adapter],
  createCanvasContext: {
    canvas: document.querySelector<HTMLCanvasElement>('#canvas'),
  },
})

const loop = makeAnimationLoop(MyAnimationLoopTemplate, { device })
loop.start()
