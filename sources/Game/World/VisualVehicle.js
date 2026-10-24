import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { Track } from '../Tracks.js'
import { Trails } from '../Trails.js'
import { remapClamp } from '../utilities/maths.js'
import { cameraPosition, color, Fn, min, mix, normalWorld, positionViewDirection, positionWorld, screenCoordinate, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { clamp } from 'three/src/math/MathUtils.js'
import gsap from 'gsap'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

export class VisualVehicle
{
    constructor(model, vehicleOptions = {})
    {
        this.game = Game.getInstance()
        
        this.model = model
        this.vehicleOptions = vehicleOptions

        this.setParts()
        this.setMainGroundTrack()
        this.setWheels()
        this.setBlinkers()
        this.setBackLights()
        this.setAntenna()
        this.setBoostTrails()
        this.setBoostAnimation()
        this.setScreenPosition()
        this.setPaints()

        this.tickCallback = () =>
        {
            this.update()
        }
        this.game.ticker.events.on('tick', this.tickCallback, 8)
    }

    destroy()
    {
        this.game.ticker.events.off('tick', this.tickCallback)

        if(this.blinkers)
        {
            this.game.inputs.events.off('left', this.blinkers.leftCallback)
            this.game.inputs.events.off('right', this.blinkers.rightCallback)
        }

        for(let partName in this.parts)
        {
            const part = this.parts[partName]
            part.removeFromParent()
        }

        this.game.tracks.remove(this.mainGroundTrack)

        for(const wheel of this.wheels.items)
        {
            this.game.tracks.remove(wheel.groundTrack)
        }
    }

    setParts()
    {
        this.parts = {}

        // Complete GLB imports have their own body and wheels, unlike the
        // split body/wheel setup used by the portfolio's default car.
        let isSplitVehicle = false
        this.model.traverse((child) =>
        {
            if(/^bodyPainted(?:$|\.)/i.test(child.name))
                isSplitVehicle = true
        })
        if(!isSplitVehicle)
        {
            // The rigged simple-car download includes a separate enlarged
            // ground plane. It is a preview floor, not part of the vehicle;
            // keeping it in the bounds shrinks the car to a tiny speck.
            this.model.getObjectByName('Ground_2')?.removeFromParent()

            const bounds = new THREE.Box3().setFromObject(this.model)
            const size = bounds.getSize(new THREE.Vector3())
            const longestAxis = Math.max(size.x, size.z)
            const vehicleScale = (this.vehicleOptions.targetLength || (this.model.getObjectByName('rb16b') ? 2.6 : 2.8)) / longestAxis

            const chassis = new THREE.Group()
            chassis.name = 'chassis'

            const importedModel = new THREE.Group()
            importedModel.add(this.model)
            importedModel.rotation.y = this.vehicleOptions.rotationY ?? Math.PI / 2
            importedModel.scale.setScalar(vehicleScale)

            // The imported race car uses very dark metallic source materials.
            // Keep its embedded livery maps, but render them without relying on
            // an environment map that the portfolio scene does not provide.
            // The RB16B is unusually dark without an environment map, so it
            // gets a simple textured material. Keep other imports' full GLTF
            // material stacks (especially specular-glossiness and alpha maps).
            if(this.model.getObjectByName('rb16b'))
            {
                this.model.traverse((child) =>
                {
                    if(!child.isMesh)
                        return

                    const makeVisibleMaterial = (material) => new THREE.MeshBasicMaterial({
                        map: material.map || null,
                        color: material.color || 0xffffff,
                        transparent: material.transparent || false,
                        opacity: material.opacity ?? 1,
                        side: material.side,
                        alphaTest: material.alphaTest || 0,
                    })

                    child.material = Array.isArray(child.material)
                        ? child.material.map(makeVisibleMaterial)
                        : makeVisibleMaterial(child.material)
                })
            }
            else if(this.vehicleOptions.name === 'Cyberpunk Hovercar')
            {
                // This asset's body color is authored almost entirely in its
                // specular/glossiness textures. Give the converted body a
                // visible cyber-blue base under this scene's low-light setup.
                this.model.traverse((child) =>
                {
                    if(!child.isMesh)
                        return

                    const materials = Array.isArray(child.material) ? child.material : [ child.material ]
                    for(const material of materials)
                    {
                        if(material.name === 'cdp_body')
                        {
                            material.color?.set(0x6564ff)
                            material.emissive?.set(0x100a38)
                            material.emissiveIntensity = 1.4
                            if('metalness' in material)
                                material.metalness = 0.45
                        }
                    }
                })
            }
            else if(this.vehicleOptions.name === 'Rowing Boat')
            {
                // The source sail and hull textures are nearly pure white;
                // tint them slightly so their shape and texture remain legible
                // against the bright water reflections.
                this.model.traverse((child) =>
                {
                    if(!child.isMesh)
                        return

                    const materials = Array.isArray(child.material) ? child.material : [ child.material ]
                    for(const material of materials)
                    {
                        material.color?.multiplyScalar(0.68)
                        if(material.emissive)
                            material.emissive.set(0x000000)
                    }
                })
            }

            chassis.add(importedModel)

            chassis.updateMatrixWorld(true)
            const fittedBounds = new THREE.Box3().setFromObject(importedModel)
            const fittedCenter = fittedBounds.getCenter(new THREE.Vector3())
            importedModel.position.set(
                -fittedCenter.x,
                -0.5 - fittedBounds.min.y,
                -fittedCenter.z,
            )

            this.parts.chassis = chassis
            this.parts.wheelContainer = new THREE.Group()
            this.parts.wheelContainer.name = 'wheelContainer'
            this.parts.wheelContainer.visible = false
            const wheelCylinder = new THREE.Object3D()
            wheelCylinder.name = 'wheelCylinder'
            this.parts.wheelContainer.add(wheelCylinder)
            this.isImportedVehicle = true

            this.game.scene.add(chassis)
            return
        }

        const searchList = [
            'bodyPainted',
            'chassis',
            'blinkerLeft',
            'blinkerRight',
            'stopLights',
            'backLights',
            'wheelContainer',
            'antenna',
            'cell1',
            'cell2',
            'cell3',
            'energy',
        ]
        for(let i = 0; i < searchList.length; i++)
        {
            searchList[i] = new RegExp(`^(${searchList[i]})`, 'i')
        }

        this.model.traverse((child) =>
        {
            if(child.isMesh)
            {
                child.receiveShadow = true
                child.castShadow = true
                child.material.shadowSide = THREE.BackSide
            }

            for(const search of searchList)
            {
                const match = child.name.match(search)

                if(match)
                {
                    this.parts[match[0]] = child
                }
            }
        })

        // Chassis
        this.parts.chassis.rotation.reorder('YXZ')
        this.game.materials.updateObject(this.parts.chassis)
        this.game.scene.add(this.parts.chassis)

        // Blinker left
        if(this.parts.blinkerLeft)
            this.parts.blinkerLeft.visible = false

        // Blinker right
        if(this.parts.blinkerRight)
            this.parts.blinkerRight.visible = false

        // Stop lights
        if(this.parts.stopLights)
            this.parts.stopLights.visible = false

        // Back lights
        if(this.parts.backLights)
            this.parts.backLights.visible = false

        // Wheel
        this.game.materials.updateObject(this.parts.wheelContainer)
    }

    setPaints()
    {
        this.paints = {}

        this.paints.choices = {}
        this.paints.choices.red = this.game.materials.getFromName('redGradient')
        this.paints.choices.orange = this.game.materials.createGradient('orangeGradient', '#ff940d', '#af0071', this.game.materials.debugPanel?.addFolder({ title: 'orangeGradient' }))
        this.paints.choices.white = this.game.materials.createGradient('whiteGradient', '#ffffff', '#b5b5b5', this.game.materials.debugPanel?.addFolder({ title: 'whiteGradient' }))
        this.paints.choices.black = this.game.materials.createGradient('blackGradient', '#626262', '#262526', this.game.materials.debugPanel?.addFolder({ title: 'blackGradient' }))
        
        // Flames
        {
            const material = this.paints.choices.red.clone()
            const baseOutput = material.outputNode
            const colorA = uniform(color('#ff9c20'))
            const colorB = uniform(color('#ff0000'))
            const emissiveStrength = uniform(7.75)

            material.outputNode = Fn(() =>
            {
                // Flames
                {
                    const newUv = uv(1).toVar()
                    const uv3 = newUv.sub(vec2(0, this.game.ticker.elapsedScaledUniform.mul(-0.075))).mul(vec2(0.96 * 1.3, 0.35 * 1.3))
                    const noise3 = texture(this.game.noises.voronoi, uv3).r

                    const uv4 = newUv.sub(vec2(0, this.game.ticker.elapsedScaledUniform.mul(-0.041))).mul(vec2(1.28 * 1.3, 0.75 * 1.3))
                    const noise4 = texture(this.game.noises.voronoi, uv4).r

                    const noiseFinal = min(noise3, noise4)
                    const stepTreshold = newUv.y.oneMinus()
                    const flameMix = noiseFinal.step(stepTreshold)

                    const flameColor = mix(colorA, colorB, newUv.y).mul(emissiveStrength)

                    baseOutput.rgb.assign(mix(baseOutput.rgb, flameColor, flameMix))
                }


                return baseOutput
            })()

            this.paints.choices.flames = material

            // Debug
            if(this.game.debug.active && this.game.materials.debugPanel)
            {
                const debugPanel = this.game.materials.debugPanel.addFolder({
                    title: 'flames',
                    expanded: true,
                })
                this.game.debug.addThreeColorBinding(debugPanel, colorA.value, 'flamesColorA')
                this.game.debug.addThreeColorBinding(debugPanel, colorB.value, 'flamesColorB')
                debugPanel.addBinding(emissiveStrength, 'value', { label: 'emissiveStrength', min: 1, max: 10, step: 0.001 })
            }
        }
        
        // Abyssal
        {
            const material = new THREE.MeshBasicMaterial({ wireframe: false })
            const fresnelColor = uniform(color('#6053ff'))
            const fresnelIntensity = uniform(30)
            const starsIntensity = uniform(10)

            material.outputNode = Fn(() =>
            {
                const starsUv = screenCoordinate.div(256).fract()
                const starsColor = texture(this.game.resources.behindTheSceneStarsTexture, starsUv).rgb.pow(2).mul(starsIntensity)
				
                const viewDirection = positionWorld.sub( cameraPosition ).normalize();
                const fresnel = viewDirection.dot(normalWorld).remapClamp(-0.2, -0.4, 1, 0)
                
                const fresnelFinalColor = fresnelColor.mul(fresnelIntensity)
                const finalColor = mix(starsColor, fresnelFinalColor, fresnel)

                finalColor.assign(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, finalColor))

                return vec4(finalColor, 1)
            })()

            this.paints.choices.abyssal = material

            // Debug
            if(this.game.debug.active && this.game.materials.debugPanel)
            {
                const debugPanel = this.game.materials.debugPanel.addFolder({
                    title: 'abyssal',
                    expanded: true,
                })
                this.game.debug.addThreeColorBinding(debugPanel, fresnelColor.value, 'fresnelColor')
                debugPanel.addBinding(fresnelIntensity, 'value', { label: 'fresnelIntensity', min: 1, max: 40, step: 0.001 })
                debugPanel.addBinding(starsIntensity, 'value', { label: 'starsIntensity', min: 1, max: 40, step: 0.001 })
            }
        }

        this.paints.changeTo = (name = 'red') =>
        {
            const material = this.paints.choices[name]

            if(!material || !this.parts.bodyPainted)
                return false

            this.parts.bodyPainted.material = material

            for(const wheel of this.wheels.items)
            {
                if(wheel.painted)
                    wheel.painted.material = material
            }
        }
        
        // From achievemnts
        this.paints.changeTo(this.game.achievements.rewards.current.name)

        this.game.achievements.events.on('rewardActiveChange', (reward) =>
        {
            this.paints.changeTo(reward.name)
        })
    }

    setMainGroundTrack()
    {
        this.mainGroundTrack = this.game.tracks.add(new Track(1.5, 'g'))
    }

    setWheels()
    {
        // Setup
        this.wheels = {}
        this.wheels.items = []
        this.wheels.steering = 0

        // Create wheels
        for(let i = 0; i < 4; i++)
        {
            const wheel = {}

            // Clone group
            wheel.container = this.parts.wheelContainer.clone(true)
            this.parts.chassis.add(wheel.container)

            wheel.container.traverse((child) =>
            {
                if(child.name.match(/^wheelSuspension/))
                    wheel.suspension = child
                if(child.name.match(/^wheelCylinder/))
                    wheel.cylinder = child
                if(child.name.match(/^wheelPainted/))
                    wheel.painted = child
            })
            
            // Cylinder (actual wheel)
            wheel.cylinder.position.set(0, 0, 0)
            
            if(i === 0 || i === 2)
                wheel.container.rotation.y = Math.PI

            // Add new track
            wheel.groundTrack = this.game.tracks.add(new Track(0.5, 'r'))

            this.wheels.items.push(wheel)
        }
    }

    setBlinkers()
    {
        if(!this.parts.blinkerLeft)
            return
            
        this.blinkers = {}

        let running = false
        let on = false

        const start = () =>
        {
            if(running)
                return

            running = true
            on = true

            this.parts.blinkerLeft.visible = this.game.inputs.actions.get('left').active ? on : false
            this.parts.blinkerRight.visible = this.game.inputs.actions.get('right').active ? on : false

            gsap.delayedCall(0.8, blink)
        }

        const blink = () =>
        {
            on = !on

            this.parts.blinkerLeft.visible = this.game.inputs.actions.get('left').active ? on : false
            this.parts.blinkerRight.visible = this.game.inputs.actions.get('right').active ? on : false

            if(!this.game.inputs.actions.get('left').active && !this.game.inputs.actions.get('right').active && !on)
            {
                running = false
            }
            else
            {
                gsap.delayedCall(0.8, blink)
            }
        }

        this.blinkers.leftCallback = (active) =>
        {
            if(active.active)
                start()
        }
        
        this.blinkers.rightCallback = (active) =>
        {
            if(active.active)
                start()
        }

        this.game.inputs.events.on('left', this.blinkers.leftCallback)
        this.game.inputs.events.on('right', this.blinkers.rightCallback)
    }

    setBackLights()
    {
        this.backLights = {}
        this.backLights.material = new THREE.MeshBasicNodeMaterial({ colorNode: vec3(2.2) })
    }

    setAntenna()
    {
        if(!this.parts.antenna)
            return

        this.antenna = {}
        this.antenna.target = new THREE.Vector3(0, 2, 0)
        this.antenna.target = new THREE.Vector3(0, 2, 0)
        this.antenna.object = this.parts.antenna
        this.antenna.head = this.model.getObjectByName('antennaHead')
        this.antenna.headAxle = this.antenna.head.children[0]
        this.antenna.headReference = this.antenna.object.getObjectByName('antennaHeadReference')

        this.game.materials.updateObject(this.antenna.head)
        this.game.scene.add(this.antenna.head)
    }

    setBoostTrails()
    {
        this.boostTrails = {}
        this.boostTrails.instance = new Trails()

        this.boostTrails.leftReference = new THREE.Object3D()
        this.boostTrails.leftReference.position.set(-1.28, 0.1, -0.55)
        this.parts.chassis.add(this.boostTrails.leftReference)

        this.boostTrails.left = this.boostTrails.instance.create()
        this.boostTrails.leftReference.getWorldPosition(this.boostTrails.left.position)
    
        this.boostTrails.rightReference = new THREE.Object3D()
        this.boostTrails.rightReference.position.set(-1.28, 0.1, 0.55)
        this.parts.chassis.add(this.boostTrails.rightReference)

        this.boostTrails.right = this.boostTrails.instance.create()
        this.boostTrails.rightReference.getWorldPosition(this.boostTrails.right.position)
    }

    setBoostAnimation()
    {
        this.boostAnimation = {}
        this.boostAnimation.mix = 0
        this.boostAnimation.speed = 1.2
        this.boostAnimation.mixUniform = uniform(0)

        // Energy
        if(this.parts.energy)
        {
            const emissiveOuput = this.game.materials.getFromName('emissivePurpleRadialGradient').outputNode
            const defaultOutput = this.parts.energy.material.outputNode

            const material = new THREE.MeshLambertNodeMaterial()
            material.outputNode = mix(defaultOutput, emissiveOuput, this.boostAnimation.mixUniform)

            this.parts.energy.material = material
        }
    }

    setScreenPosition()
    {
        this.screenPosition = new THREE.Vector2(0, 0)
    }

    update()
    {
        const physicalVehicle = this.game.physicalVehicle
        
        // Chassis
        this.parts.chassis.position.copy(physicalVehicle.position)
        this.parts.chassis.quaternion.copy(physicalVehicle.quaternion)
        
        // Wheels
        this.wheels.steering += ((this.game.player.steering * physicalVehicle.steeringAmplitude) - this.wheels.steering) * this.game.ticker.deltaScaled * 16

        const wheelsRotation = (physicalVehicle.forwardSpeed) / physicalVehicle.wheels.settings.radius * 0.006

        for(let i = 0; i < 4; i++)
        {
            const visualWheel = this.wheels.items[i]
            const physicalWheel = physicalVehicle.wheels.items[i]

            if(this.isImportedVehicle)
                continue

            // visualWheel.container.position.copy(physicalWheel.basePosition)

            if(!this.game.inputs.actions.get('brake').active || this.game.inputs.actions.get('forward').active || this.game.inputs.actions.get('backward').active)
            {
                if(i === 0 || i === 2)
                    visualWheel.cylinder.rotation.z += wheelsRotation
                else
                    visualWheel.cylinder.rotation.z -= wheelsRotation
            }

            if(i === 0)
                visualWheel.container.rotation.y = Math.PI + this.wheels.steering

            if(i === 1)
                visualWheel.container.rotation.y = this.wheels.steering
  
            // Physics can report null during its first frame (and while its
            // wheel controller is paused). Letting that reach the smoothing
            // math turns the wheel position into NaN permanently, which makes
            // the default car look like it has missing or misplaced wheels.
            const configuredSuspension = this.game.player.suspensions[i]
            const fallbackSuspension = this.game.physicalVehicle.suspensionsHeights[configuredSuspension] ?? 0.88
            const suspensionLength = Number.isFinite(physicalWheel.suspensionLength)
                ? physicalWheel.suspensionLength
                : fallbackSuspension
            let wheelY = physicalWheel.basePosition.y - suspensionLength
            // The original GLB supplies one wheel as a template, positioned
            // close under the body. Rapier may report its full 2 m travel
            // while the car is still settling; letting the visual wheel follow
            // that value makes the tires look detached from the chassis.
            const maxVisualDrop = Math.abs(this.parts.wheelContainer.position.y) + 0.15
            wheelY = Math.max(wheelY, -maxVisualDrop)
            wheelY = Math.min(wheelY, -0.5)

            visualWheel.container.position.x = Number.isFinite(physicalWheel.basePosition.x) ? physicalWheel.basePosition.x : 0
            if(!Number.isFinite(visualWheel.container.position.y))
                visualWheel.container.position.y = wheelY
            else
                visualWheel.container.position.y += (wheelY - visualWheel.container.position.y) * 25 * this.game.ticker.deltaScaled
            visualWheel.container.position.z = Number.isFinite(physicalWheel.basePosition.z) ? physicalWheel.basePosition.z : 0

            if(visualWheel.suspension)
            {
                const suspensionScale = Math.max(0.05, Math.abs(visualWheel.container.position.y) - 0.5)
                visualWheel.suspension.scale.y = suspensionScale
            }

            // Ground tracks
            visualWheel.groundTrack.update(physicalWheel.contactPoint, physicalWheel.inContact)
        }

        // Main ground track
        if(this.vehicleOptions.type !== 'water')
            this.mainGroundTrack.update(physicalVehicle.position, physicalVehicle.position.y < 1.5)

        // Antenna
        if(this.antenna)
        {
            const angle = Math.atan2(this.antenna.target.x - physicalVehicle.position.x, this.antenna.target.z - physicalVehicle.position.z)
            this.antenna.object.rotation.y = angle - this.parts.chassis.rotation.y
            this.antenna.headReference.getWorldPosition(this.antenna.head.position)
            this.antenna.head.lookAt(this.antenna.target)

            const antennaTargetDistance = this.antenna.target.distanceTo(physicalVehicle.position)
            
            const antennaRotationSpeed = remapClamp(antennaTargetDistance, 50, 5, 1, 10)
            this.antenna.headAxle.rotation.z += this.game.ticker.deltaScaled * antennaRotationSpeed
        }

        // Stop/back lights
        if(this.game.player.braking)
        {
            if(this.parts.stopLights)
                this.parts.stopLights.visible = true

            if(this.parts.backLights)
            {
                this.parts.backLights.visible = true
                this.parts.backLights.material = this.game.materials.getFromName('emissiveOrangeRadialGradient')
            }
        }
        else
        {
            if(this.parts.stopLights)
                this.parts.stopLights.visible = false

            if(this.parts.backLights)
            {
                // Backward
                if(this.game.player.accelerating < 0)
                {
                    this.parts.backLights.visible = true
                    this.parts.backLights.material = this.backLights.material
                }
                // Backward
                else
                {
                    this.parts.backLights.visible = false
                }
            }
        }

        // Boost trails
        const trailAlpha = physicalVehicle.goingForward && this.game.player.boosting && this.game.player.accelerating > 0 ? 1 : 0
        this.boostTrails.leftReference.getWorldPosition(this.boostTrails.left.position)
        this.boostTrails.left.alpha = trailAlpha
        this.boostTrails.rightReference.getWorldPosition(this.boostTrails.right.position)
        this.boostTrails.right.alpha = trailAlpha

        // Boost animation
        this.boostAnimation.mix += (this.game.player.boosting ? 1 : - 1) * this.game.ticker.deltaScaled * this.boostAnimation.speed
        this.boostAnimation.mix = clamp(this.boostAnimation.mix, 0, 1)
        // this.boostAnimation.mixUniform.value = remapClamp(this.boostAnimation.mix, 0, 0.2, 0, 1)
        this.boostAnimation.mixUniform.value = 1 - Math.pow(1 - this.boostAnimation.mix, 7)
        if(this.parts.energy)
        {
            this.parts.cell1.position.y = remapClamp(this.boostAnimation.mix, 0, 0.6, 0.2, 0)
            this.parts.cell3.position.y = remapClamp(this.boostAnimation.mix, 0.2, 0.8, 0.2, 0)
            this.parts.cell2.position.y = remapClamp(this.boostAnimation.mix, 0.4, 1, 0.2, 0)
        }

        // Screen position
        const vector = new THREE.Vector3()
        vector.setFromMatrixPosition(this.parts.chassis.matrixWorld)
        vector.project(this.game.view.camera)

        this.screenPosition.x = (vector.x * 0.5 + 0.5)
        this.screenPosition.y = (vector.y * -0.5 + 0.5)
    }
}
