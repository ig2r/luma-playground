import { Buffer, luma, ShaderUniformType, UniformStore } from '@luma.gl/core'
import { AnimationLoopTemplate, AnimationProps, KeyFrames, makeAnimationLoop, Model, Timeline } from '@luma.gl/engine'
import { webgl2Adapter } from '@luma.gl/webgl'
import { Matrix4, Vector3 } from '@math.gl/core'
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

    fragColor = vec4(vec3(cosAngle), 1.0);
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

const eyePosition = [0, 0, 4]
const lightPosition = [-2, 2, 4]

class MyAnimationLoopTemplate extends AnimationLoopTemplate {
  viewMatrix = new Matrix4().lookAt({ eye: eyePosition })
  projectionMatrix = new Matrix4()

  vertexDataBuffer: Buffer
  model: Model

  keyFramesX: KeyFrames<number>
  keyFramesY: KeyFrames<number>

  uniformStore = new UniformStore<{ app: AppUniforms, lighting: LightingUniforms }>({ app, lighting })

  constructor({ device, animationLoop }: AnimationProps) {
    super()

    const v1 = new Vector3([0.0, 0.0, 0.0])
    const v2 = new Vector3([1.0, 0.0, 0.0])
    const v3 = new Vector3([0.0, 1.0, 0.0])
    const v4 = new Vector3([0.0, 0.0, 1.0])

    const calculateSurfaceNormal = (p1: Vector3, p2: Vector3, p3: Vector3) => {
      const u = new Vector3(p2).subtract(p1)
      const v = new Vector3(p3).subtract(p2)
      return u.cross(v).normalize()
    }

    // Calculate surface normals, then build interleaved buffer with faces and corresponding
    // face normals (fn...), shared among all vertices of a face.
    const fn1 = calculateSurfaceNormal(v1, v3, v2)
    const fn2 = calculateSurfaceNormal(v1, v4, v3)
    const fn3 = calculateSurfaceNormal(v1, v2, v4)
    const fn4 = calculateSurfaceNormal(v2, v3, v4)

    const vertexData = new Float32Array([
      ...v1, ...fn1, ...v3, ...fn1, ...v2, ...fn1,
      ...v1, ...fn2, ...v4, ...fn2, ...v3, ...fn2,
      ...v1, ...fn3, ...v2, ...fn3, ...v4, ...fn3,
      ...v2, ...fn4, ...v3, ...fn4, ...v4, ...fn4,
    ])

    this.vertexDataBuffer = device.createBuffer(vertexData)

    this.model = new Model(device, {
      vs,
      fs,

      // Describe how many vertices to expect and how to assemble them into faces:
      topology: 'triangle-list',
      vertexCount: 4 * 3,

      // Describe how per-vertex data (attributes) are laid out in the input buffer:
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
        vertexData: this.vertexDataBuffer,
      },

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

    this.uniformStore.setUniforms({
      lighting: {
        lightPosition: new Vector3(this.viewMatrix.transformAsPoint(lightPosition)),
      },
    })

    const keyFrameData: [number, number][] = [
      [0, 0],
      // [1000, 0.5 * Math.PI],
      [2000, 2 * Math.PI],
    ]

    const timeline = new Timeline()

    this.keyFramesX = new KeyFrames(keyFrameData)
    this.keyFramesY = new KeyFrames(keyFrameData)
    const channelX = timeline.addChannel({ duration: 2000, repeat: Number.POSITIVE_INFINITY })
    const channelY = timeline.addChannel({ rate: 0.7, duration: 2000 / 0.7, repeat: Number.POSITIVE_INFINITY })
    timeline.attachAnimation(this.keyFramesX, channelX)
    timeline.attachAnimation(this.keyFramesY, channelY)

    animationLoop.attachTimeline(timeline)
    timeline.play()
  }

  override onFinalize(_: AnimationProps) {
    this.vertexDataBuffer.destroy()
    this.model.destroy()
    this.uniformStore.destroy()
  }

  override onRender({ device, aspect }: AnimationProps) {
    const startRotationX = this.keyFramesX.getStartData()
    const endRotationX = this.keyFramesX.getEndData()
    const rotationX = startRotationX + this.keyFramesX.factor * (endRotationX - startRotationX)

    const startRotationY = this.keyFramesY.getStartData()
    const endRotationY = this.keyFramesY.getEndData()
    const rotationY = startRotationY + this.keyFramesY.factor * (endRotationY - startRotationX)

    const modelViewMatrix = new Matrix4(this.viewMatrix).rotateXYZ([rotationX, rotationY, 0])
    this.projectionMatrix.perspective({ fovy: Math.PI / 3, aspect })

    this.uniformStore.setUniforms({
      app: {
        modelViewMatrix,
        projectionMatrix: this.projectionMatrix,
      },
    })

    const renderPass = device.beginRenderPass({ clearColor: [1, 1, 1, 1] })
    this.model.draw(renderPass)
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
