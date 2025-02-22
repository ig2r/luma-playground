import { Buffer, luma, ShaderUniformType, UniformStore } from '@luma.gl/core'
import { AnimationLoopTemplate, AnimationProps, KeyFrames, makeAnimationLoop, Model, Timeline } from '@luma.gl/engine'
import { webgl2Adapter } from '@luma.gl/webgl'
import { Matrix4, Vector3 } from '@math.gl/core'
import './style.css'

const vs = `\
  #version 300 es

  uniform appUniforms {
    mat4 modelViewProjectionMatrix;
    mat4 modelViewMatrix;
  } app;

  in vec3 position;
  in vec3 vertexNormal;

  out vec3 vVertex;
  out vec3 vNormal;

  void main() {
    vVertex = vec3(app.modelViewMatrix * vec4(position, 1.0));
    vNormal = vec3(app.modelViewMatrix * vec4(vertexNormal, 0.0));

    gl_Position = app.modelViewProjectionMatrix * vec4(position, 1.0);
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
    // N.B. the following assumes that the light position is already in camera space,
    // same as vVertex.
    vec3 toLight = normalize(lighting.lightPosition - vVertex);
    float cosAngle = dot(normalize(vNormal), toLight);
    cosAngle = clamp(cosAngle, 0.0, 1.0);

    fragColor = vec4(vec3(cosAngle), 1.0);
  }
`

type AppUniforms = {
  mvpMatrix: Matrix4
  mvMatrix: Matrix4
}

type LightingUniforms = {
  lightPosition: Vector3
}

const app: { uniformTypes: Record<keyof AppUniforms, ShaderUniformType> } = {
  uniformTypes: {
    mvpMatrix: 'mat4x4<f32>',
    mvMatrix: 'mat4x4<f32>',
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
  mvpMatrix = new Matrix4()
  viewMatrix = new Matrix4().lookAt({ eye: eyePosition })

  positionBuffer: Buffer
  vertexNormalBuffer: Buffer
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

    const surfaceNormal = (p1: Vector3, p2: Vector3, p3: Vector3) => {
      const u = new Vector3(p2).subtract(p1)
      const v = new Vector3(p3).subtract(p2)
      return u.cross(v).normalize()
    }

    // Calculate surface normals
    const fn1 = surfaceNormal(v1, v3, v2)
    const fn2 = surfaceNormal(v1, v4, v3)
    const fn3 = surfaceNormal(v1, v2, v4)
    const fn4 = surfaceNormal(v2, v3, v4)

    this.positionBuffer = device.createBuffer(
      new Float32Array([
        ...v1, ...v3, ...v2,
        ...v1, ...v4, ...v3,
        ...v1, ...v2, ...v4,
        ...v2, ...v3, ...v4,
      ])
    )

    this.vertexNormalBuffer = device.createBuffer(
      new Float32Array([
        ...fn1, ...fn1, ...fn1,
        ...fn2, ...fn2, ...fn2,
        ...fn3, ...fn3, ...fn3,
        ...fn4, ...fn4, ...fn4,
      ])
    )

    this.model = new Model(device, {
      vs,
      fs,
      // geometry: new CubeGeometry({ indices: false }),
      // geometry: new IcoSphereGeometry({ iterations: 1 }),

      // Instead of using a pre-made geometry, the following block of properties
      // wires up the vertex and normals buffers to the appropriate shader attributes:
      bufferLayout: [
        { name: 'position', format: 'float32x3' },
        { name: 'vertexNormal', format: 'float32x3' },
      ],
      attributes: {
        position: this.positionBuffer,
        vertexNormal: this.vertexNormalBuffer,
      },
      vertexCount: 4 * 3,
      topology: 'triangle-list',

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
    this.positionBuffer.destroy()
    this.vertexNormalBuffer.destroy()
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

    const mvMatrix = new Matrix4(this.viewMatrix)
      .rotateXYZ([rotationX, rotationY, 0])

    this.mvpMatrix
      .perspective({ fovy: Math.PI / 3, aspect })
      .multiplyRight(mvMatrix)

    this.uniformStore.setUniforms({
      app: {
        mvpMatrix: this.mvpMatrix,
        mvMatrix,
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
