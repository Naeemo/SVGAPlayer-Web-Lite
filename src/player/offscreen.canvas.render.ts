import { IBezierPath } from '../common/bezier-path'
import EllipsePath from '../common/ellipse-path'
import RectPath from '../common/rect-path'
import VideoEntity, { ImageSources } from '../parser/video-entity'
import { DynamicElement } from './renderer'
import { com } from '../proto/svga'
import { IParseStyles } from '../parser'
import svga = com.opensource.svga

const validMethods = 'MLHVCSQRZmlhvcsqrz'

function render(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  bitmapCache: ImageSources,
  dynamicElements: { [key: string]: DynamicElement },
  videoItem: VideoEntity,
  currentFrame: number
): HTMLCanvasElement | OffscreenCanvas {
  const context = canvas.getContext('2d')

  if (context === null) {
    console.error('svga render fail, 2d context null')
    return canvas
  }

  videoItem.sprites.forEach((sprite) => {
    const frameItem = sprite.frames[currentFrame]

    if (frameItem.alpha < 0.05) {
      return
    }

    context.save()
    context.globalAlpha = frameItem.alpha
    context.transform(
      frameItem.transform.a || 1,
      frameItem.transform.b || 0,
      frameItem.transform.c || 0,
      frameItem.transform.d || 1,
      frameItem.transform.tx || 0,
      frameItem.transform.ty || 0
    )

    const img = sprite.imageKey && bitmapCache[sprite.imageKey]
    if (img) {
      if (frameItem.clipPath) {
        drawBezier(context, {
          _d: frameItem.clipPath,
        })
        context.clip()
      }
      context.drawImage(img, 0, 0)
    }

    const dynamicElement = sprite.imageKey && dynamicElements[sprite.imageKey]
    if (dynamicElement) {
      const { source, fit } =
        'fit' in dynamicElement
          ? dynamicElement
          : { source: dynamicElement, fit: 'none' }
      let sourceWidth: number, sourceHeight: number
      if (source instanceof HTMLImageElement) {
        sourceWidth = source.naturalWidth
        sourceHeight = source.naturalHeight
      } else if (source instanceof HTMLVideoElement) {
        sourceWidth = source.videoWidth
        sourceHeight = source.videoHeight
      } else if (source instanceof SVGImageElement) {
        sourceWidth = source.width.baseVal.value
        sourceHeight = source.height.baseVal.value
      } else {
        sourceWidth = source.width
        sourceHeight = source.height
      }

      switch (fit) {
        case 'contain': {
          const wRatio = frameItem.layout.width / sourceWidth
          const hRatio = frameItem.layout.height / sourceHeight
          const ratio = Math.min(wRatio, hRatio)
          const width = ratio * sourceWidth
          const height = ratio * sourceHeight
          context.drawImage(
            source,
            (frameItem.layout.width - width) / 2,
            (frameItem.layout.height - height) / 2,
            width,
            height
          )
          break
        }
        case 'cover': {
          const wRatio = frameItem.layout.width / sourceWidth
          const hRatio = frameItem.layout.height / sourceHeight
          const ratio = Math.max(wRatio, hRatio)
          const width = ratio * sourceWidth
          const height = ratio * sourceHeight
          context.drawImage(
            source,
            (frameItem.layout.width - width) / 2,
            (frameItem.layout.height - height) / 2,
            width,
            height
          )
          break
        }
        case 'fill':
          context.drawImage(
            source,
            0,
            0,
            frameItem.layout.width,
            frameItem.layout.height
          )
          break
        case 'none':
        default:
          context.drawImage(
            source,
            (frameItem.layout.width - sourceWidth) / 2,
            (frameItem.layout.height - sourceHeight) / 2
          )
          break
      }
    }

    frameItem.shapes &&
      frameItem.shapes.forEach((shape) => {
        if (
          shape.type === svga.ShapeEntity.ShapeType.SHAPE &&
          shape.shape &&
          shape.shape.d
        ) {
          drawBezier(context, {
            _d: shape.shape.d,
            _transform: shape.transform,
            _styles: shape.styles,
          })
        } else if (
          shape.type === svga.ShapeEntity.ShapeType.ELLIPSE &&
          shape.ellipse
        ) {
          drawEllipse(
            context,
            new EllipsePath(
              shape.ellipse.x || 0.0,
              shape.ellipse.y || 0.0,
              shape.ellipse.radiusX || 0.0,
              shape.ellipse.radiusY || 0.0,
              shape.transform,
              shape.styles
            )
          )
        } else if (
          shape.type === svga.ShapeEntity.ShapeType.RECT &&
          shape.rect
        ) {
          drawRect(
            context,
            new RectPath(
              shape.rect.x || 0.0,
              shape.rect.y || 0.0,
              shape.rect.width || 0.0,
              shape.rect.height || 0.0,
              shape.rect.cornerRadius || 0.0,
              shape.transform,
              shape.styles
            )
          )
        }
      })
    context.restore()
  })

  return canvas
}

function resetShapeStyles(context, styles: IParseStyles) {
  context.strokeStyle = styles?.strokeStr || 'transparent'

  if (styles) {
    context.lineWidth = styles.strokeWidth || undefined
    context.lineCap = styles.lineCapStr || undefined
    context.lineJoin = styles.lineJoinStr || undefined
    context.miterLimit = styles.miterLimit || undefined
  }

  context.fillStyle = styles?.fillStr || 'transparent'

  if (styles.lineDashI || styles.lineDashII || styles.lineDashIII) {
    context.setLineDash([
      styles.lineDashI ? styles.lineDashI : 0,
      styles.lineDashII ? styles.lineDashII : 0,
      styles.lineDashIII ? styles.lineDashIII : 0,
    ])
  }
}

function drawBezier(context, obj: IBezierPath) {
  context.save()

  obj._styles && resetShapeStyles(context, obj._styles)

  if (obj._transform) {
    context.transform(
      obj._transform.a || 1.0,
      obj._transform.b || 0,
      obj._transform.c || 0,
      obj._transform.d || 1.0,
      obj._transform.tx || 0,
      obj._transform.ty || 0
    )
  }

  const currentPoint = { x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0 }

  context.beginPath()

  const d = obj._d.replace(/([a-zA-Z])/g, '|||$1 ').replace(/,/g, ' ')

  d.split('|||').forEach((segment) => {
    if (segment.length == 0) return
    const firstLetter = segment.substr(0, 1)
    if (validMethods.indexOf(firstLetter) >= 0) {
      const args = segment.substr(1).trim().split(' ')
      drawBezierElement(context, currentPoint, firstLetter, args)
    }
  })

  if (obj._styles && obj._styles.fill) {
    context.fill()
  } else if (obj._styles && obj._styles.stroke) {
    context.stroke()
  }

  context.restore()
}

function drawBezierElement(context, currentPoint, method, args) {
  switch (method) {
    case 'M':
      currentPoint.x = Number(args[0])
      currentPoint.y = Number(args[1])
      context.moveTo(currentPoint.x, currentPoint.y)
      break
    case 'm':
      currentPoint.x += Number(args[0])
      currentPoint.y += Number(args[1])
      context.moveTo(currentPoint.x, currentPoint.y)
      break
    case 'L':
      currentPoint.x = Number(args[0])
      currentPoint.y = Number(args[1])
      context.lineTo(currentPoint.x, currentPoint.y)
      break
    case 'l':
      currentPoint.x += Number(args[0])
      currentPoint.y += Number(args[1])
      context.lineTo(currentPoint.x, currentPoint.y)
      break
    case 'H':
      currentPoint.x = Number(args[0])
      context.lineTo(currentPoint.x, currentPoint.y)
      break
    case 'h':
      currentPoint.x += Number(args[0])
      context.lineTo(currentPoint.x, currentPoint.y)
      break
    case 'V':
      currentPoint.y = Number(args[0])
      context.lineTo(currentPoint.x, currentPoint.y)
      break
    case 'v':
      currentPoint.y += Number(args[0])
      context.lineTo(currentPoint.x, currentPoint.y)
      break
    case 'C':
      currentPoint.x1 = Number(args[0])
      currentPoint.y1 = Number(args[1])
      currentPoint.x2 = Number(args[2])
      currentPoint.y2 = Number(args[3])
      currentPoint.x = Number(args[4])
      currentPoint.y = Number(args[5])
      context.bezierCurveTo(
        currentPoint.x1,
        currentPoint.y1,
        currentPoint.x2,
        currentPoint.y2,
        currentPoint.x,
        currentPoint.y
      )
      break
    case 'c':
      currentPoint.x1 = currentPoint.x + Number(args[0])
      currentPoint.y1 = currentPoint.y + Number(args[1])
      currentPoint.x2 = currentPoint.x + Number(args[2])
      currentPoint.y2 = currentPoint.y + Number(args[3])
      currentPoint.x += Number(args[4])
      currentPoint.y += Number(args[5])
      context.bezierCurveTo(
        currentPoint.x1,
        currentPoint.y1,
        currentPoint.x2,
        currentPoint.y2,
        currentPoint.x,
        currentPoint.y
      )
      break
    case 'S':
      if (
        currentPoint.x1 &&
        currentPoint.y1 &&
        currentPoint.x2 &&
        currentPoint.y2
      ) {
        currentPoint.x1 = currentPoint.x - currentPoint.x2 + currentPoint.x
        currentPoint.y1 = currentPoint.y - currentPoint.y2 + currentPoint.y
        currentPoint.x2 = Number(args[0])
        currentPoint.y2 = Number(args[1])
        currentPoint.x = Number(args[2])
        currentPoint.y = Number(args[3])
        context.bezierCurveTo(
          currentPoint.x1,
          currentPoint.y1,
          currentPoint.x2,
          currentPoint.y2,
          currentPoint.x,
          currentPoint.y
        )
      } else {
        currentPoint.x1 = Number(args[0])
        currentPoint.y1 = Number(args[1])
        currentPoint.x = Number(args[2])
        currentPoint.y = Number(args[3])
        context.quadraticCurveTo(
          currentPoint.x1,
          currentPoint.y1,
          currentPoint.x,
          currentPoint.y
        )
      }
      break
    case 's':
      if (
        currentPoint.x1 &&
        currentPoint.y1 &&
        currentPoint.x2 &&
        currentPoint.y2
      ) {
        currentPoint.x1 = currentPoint.x - currentPoint.x2 + currentPoint.x
        currentPoint.y1 = currentPoint.y - currentPoint.y2 + currentPoint.y
        currentPoint.x2 = currentPoint.x + Number(args[0])
        currentPoint.y2 = currentPoint.y + Number(args[1])
        currentPoint.x += Number(args[2])
        currentPoint.y += Number(args[3])
        context.bezierCurveTo(
          currentPoint.x1,
          currentPoint.y1,
          currentPoint.x2,
          currentPoint.y2,
          currentPoint.x,
          currentPoint.y
        )
      } else {
        currentPoint.x1 = currentPoint.x + Number(args[0])
        currentPoint.y1 = currentPoint.y + Number(args[1])
        currentPoint.x += Number(args[2])
        currentPoint.y += Number(args[3])
        context.quadraticCurveTo(
          currentPoint.x1,
          currentPoint.y1,
          currentPoint.x,
          currentPoint.y
        )
      }
      break
    case 'Q':
      currentPoint.x1 = Number(args[0])
      currentPoint.y1 = Number(args[1])
      currentPoint.x = Number(args[2])
      currentPoint.y = Number(args[3])
      context.quadraticCurveTo(
        currentPoint.x1,
        currentPoint.y1,
        currentPoint.x,
        currentPoint.y
      )
      break
    case 'q':
      currentPoint.x1 = currentPoint.x + Number(args[0])
      currentPoint.y1 = currentPoint.y + Number(args[1])
      currentPoint.x += Number(args[2])
      currentPoint.y += Number(args[3])
      context.quadraticCurveTo(
        currentPoint.x1,
        currentPoint.y1,
        currentPoint.x,
        currentPoint.y
      )
      break
    case 'A':
      break
    case 'a':
      break
    case 'Z':
    case 'z':
      context.closePath()
      break
    default:
      break
  }
}

function drawEllipse(context, obj: EllipsePath) {
  context.save()

  obj._styles && resetShapeStyles(context, obj._styles)

  if (obj._transform !== undefined && obj._transform !== null) {
    context.transform(
      obj._transform.a || 1.0,
      obj._transform.b || 0,
      obj._transform.c || 0,
      obj._transform.d || 1.0,
      obj._transform.tx || 0,
      obj._transform.ty || 0
    )
  }

  const x = obj._x - obj._radiusX
  const y = obj._y - obj._radiusY
  const w = obj._radiusX * 2
  const h = obj._radiusY * 2

  const kappa = 0.5522848

  const ox = (w / 2) * kappa
  const oy = (h / 2) * kappa

  const xe = x + w
  const ye = y + h

  const xm = x + w / 2
  const ym = y + h / 2

  context.beginPath()
  context.moveTo(x, ym)
  context.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y)
  context.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym)
  context.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye)
  context.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym)

  if (obj._styles && obj._styles.fill) {
    context.fill()
  } else if (obj._styles && obj._styles.stroke) {
    context.stroke()
  }

  context.restore()
}

function drawRect(context, obj) {
  context.save()

  obj._styles && resetShapeStyles(context, obj._styles)

  if (obj._transform !== undefined && obj._transform !== null) {
    context.transform(
      obj._transform.a || 1.0,
      obj._transform.b || 0,
      obj._transform.c || 0,
      obj._transform.d || 1.0,
      obj._transform.tx || 0,
      obj._transform.ty || 0
    )
  }

  const x = obj._x
  const y = obj._y
  const width = obj._width
  const height = obj._height
  let radius = obj._cornerRadius

  if (width < 2 * radius) {
    radius = width / 2
  }

  if (height < 2 * radius) {
    radius = height / 2
  }

  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)

  context.closePath()

  if (obj._styles && obj._styles.fill) {
    context.fill()
  } else if (obj._styles && obj._styles.stroke) {
    context.stroke()
  }

  context.restore()
}

export default render
