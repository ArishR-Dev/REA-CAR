import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { VisualVehicle } from './World/VisualVehicle.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'

export class KonamiCode
{
    constructor(once = false)
    {
        this.game = Game.getInstance()

        let index = 0
        this.activationCount = 0
        const sequence = [
            [ 'ArrowUp', 'KeyW' ],
            [ 'ArrowUp', 'KeyW' ],
            [ 'ArrowDown', 'KeyS' ],
            [ 'ArrowDown', 'KeyS' ],
            [ 'ArrowLeft', 'KeyA' ],
            [ 'ArrowRight', 'KeyD' ],
            [ 'ArrowLeft', 'KeyA' ],
            [ 'ArrowRight', 'KeyD' ],
            [ 'KeyB' ],
            [ 'KeyQ', 'KeyA' ],
        ]

        const callback = (event) =>
        {
            if(event.code === 'KeyC' && !event.repeat)
            {
                this.cycleVehicle()
                index = 0
                return
            }

            const sequenceItem = sequence[index]

            if(sequenceItem.indexOf(event.code) !== -1)
            {
                index++

                if(index === sequence.length)
                {
                    this.activate()

                    if(once)
                        document.removeEventListener('keydown', callback)

                    index = 0
                }
            }
            else
            {
                index = 0
            }
        }
        document.addEventListener('keydown', callback)

        this.vehicles = [
            { name: 'Simple Car', type: 'land', path: 'vehicle/custom/simple-car/scene.gltf', targetLength: 3.1 },
            { name: 'Evo Rally Car', type: 'land', path: 'vehicle/custom/evo-rally/scene.gltf', targetLength: 3.4 },
            { name: 'Old school', type: 'land', path: 'vehicle/oldSchool.glb' },
            { name: 'Red Bull RB16B', type: 'land', path: 'vehicle/rb16b/source/rb16.glb' },
            { name: 'Cyberpunk Hovercar', type: 'both', path: 'vehicle/custom/cyberpunk-hovercar-pbr.glb', targetLength: 2.8 },
            { name: '1972 Datsun 240K GT', type: 'land', path: 'vehicle/custom/datsun-240k.glb', targetLength: 2.9 },
            { name: '1975 Porsche 911 Turbo', type: 'land', path: 'vehicle/custom/porsche-911/scene.gltf', targetLength: 2.8 },
            { name: 'Rowing Boat', type: 'water', path: 'vehicle/custom/rowing-boat.glb', targetLength: 3.1 },
            { name: 'Motor Boat', type: 'water', path: 'vehicle/custom/boat.glb', targetLength: 3.1 },
            { name: 'Low-poly Boat', type: 'water', path: 'vehicle/custom/boat-lowpoly.glb', targetLength: 3.1 },
        ]
        this.vehicleIndex = 0
        this.switchToken = 0
        this.environmentSwitchPending = false
        this.createVehicleHint()
        this.game.ticker.events.on('tick', () => this.enforceVehicleEnvironment(), 6.5)
    }

    async activate()
    {
        const index = this.activationCount % 2 === 0 ? 1 : 0
        await this.setVehicle(index)

        if(this.game.world.confetti)
        {
            this.game.world.confetti.pop(this.game.player.position.clone())
            this.game.world.confetti.pop(this.game.player.position.clone().add(new THREE.Vector3(1, -1, 1.5)))
            this.game.world.confetti.pop(this.game.player.position.clone().add(new THREE.Vector3(1, -1, -1.5)))
        }

        this.activationCount++

        // Achievement
        this.game.achievements.setProgress('konami', 1)
    }

    createVehicleHint()
    {
        const hint = document.createElement('div')
        hint.textContent = 'C · change vehicle'
        Object.assign(hint.style, {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            zIndex: '20',
            padding: '8px 12px',
            borderRadius: '6px',
            color: '#fff',
            background: 'rgba(20, 20, 24, 0.72)',
            font: '600 12px/1.3 system-ui, sans-serif',
            letterSpacing: '0.02em',
            pointerEvents: 'none',
        })
        document.body.appendChild(hint)
        this.vehicleHint = hint
    }

    async cycleVehicle()
    {
        for(let offset = 1; offset <= this.vehicles.length; offset++)
        {
            const index = (this.vehicleIndex + offset) % this.vehicles.length
            if(this.canUseVehicle(this.vehicles[index]))
            {
                await this.setVehicle(index)
                return
            }
        }
        this.vehicleHint.textContent = 'Boats are only available in water'
    }

    canUseVehicle(vehicle)
    {
        if(vehicle.type === 'both')
            return true

        return vehicle.type === 'water' ? this.isInWater() : !this.isInWater()
    }

    isInWater()
    {
        const position = this.game.physicalVehicle.position

        // Bridges cross mapped water but are solid driving surfaces. Detect
        // their deck colliders in world space before consulting the water map.
        if(this.isOnBridge(position))
            return false

        const terrainTexture = this.game.resources?.terrainTexture
        const image = terrainTexture?.image || terrainTexture?.source?.data

        if(image?.width && image?.height)
        {
            if(!this.terrainWaterMapInitialized)
            {
                this.terrainWaterMapInitialized = true
                try
                {
                    const canvas = document.createElement('canvas')
                    canvas.width = image.width
                    canvas.height = image.height
                    const context = canvas.getContext('2d', { willReadFrequently: true })
                    context.drawImage(image, 0, 0, image.width, image.height)
                    this.terrainWaterMap = {
                        data: context.getImageData(0, 0, image.width, image.height).data,
                        width: image.width,
                        height: image.height,
                    }
                }
                catch(error)
                {
                    console.warn('Could not read terrain water map; using vehicle height to detect water.', error)
                    this.terrainWaterMap = null
                }
            }

            if(this.terrainWaterMap)
            {
                const { data, width, height } = this.terrainWaterMap
                const u = position.x / 192 + 0.5
                const v = position.z / 192 + 0.5

                if(u < 0 || u >= 1 || v < 0 || v >= 1)
                    return false

                const px = Math.floor(u * width)
                // This texture uses flipY=false, so raw image rows run
                // opposite to the terrain shader's UV v coordinate.
                const py = Math.floor((1 - v) * height)
                const blue = data[(py * width + px) * 4 + 2] / 255
                return blue > 0.17
            }
        }

        const surface = this.game.water?.surfaceElevation ?? -0.3
        return position.y < surface + 0.65
    }

    isOnBridge(position = this.game.physicalVehicle.position)
    {
        for(const object of this.game.objects.list.values())
        {
            const name = object.visual?.object3D?.name || ''
            if(!/^bridge/i.test(name) || !object.physical)
                continue

            for(const collider of object.physical.colliders)
            {
                if(typeof collider.halfExtents !== 'function')
                    continue

                const half = collider.halfExtents()
                // The bridge deck is the broad, flat cuboid. Ignore its thin
                // rail colliders so driving below the bridge remains boating.
                if(half.x < 1.3 || half.z < 4.5)
                    continue

                const center = collider.translation()
                const top = center.y + half.y
                if(position.y < top + 0.18)
                    continue

                const rotation = collider.rotation()
                const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
                const offset = new THREE.Vector3(position.x - center.x, 0, position.z - center.z)
                const localX = offset.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion))
                const localZ = offset.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion))

                if(Math.abs(localX) <= half.x + 0.9 && Math.abs(localZ) <= half.z + 0.9)
                    return true
            }
        }

        return false
    }

    enforceVehicleEnvironment()
    {
        if(this.environmentSwitchPending)
            return

        const inWater = this.isInWater()
        const vehicle = this.vehicles[this.vehicleIndex]
        const targetIndex = inWater
            ? (vehicle.type === 'water' || vehicle.type === 'both' ? -1 : this.vehicles.findIndex((item) => item.type === 'water'))
            : (vehicle.type === 'water' ? 0 : -1)

        if(targetIndex < 0)
            return

        this.environmentSwitchPending = true
        // Stop land vehicles from accelerating in water while a boat loads.
        if(inWater)
            this.game.physicalVehicle.setVehicleMode('blocked')

        this.setVehicle(targetIndex)
            .finally(() =>
            {
                this.environmentSwitchPending = false
            })
    }

    async setVehicle(index)
    {
        const vehicle = this.vehicles[index]
        if(!this.canUseVehicle(vehicle))
        {
            this.vehicleHint.textContent = vehicle.type === 'water'
                ? 'Boats can only be used in water'
                : 'Only boats can be used in water'
            return
        }
        const token = ++this.switchToken

        try
        {
            if(!vehicle.sceneTemplate)
            {
                const resourceKey = `vehicleChoice${index}`
                const resources = await this.game.resourcesLoader.load([
                    [ resourceKey, `${vehicle.path}?cb=vehicle-choice-${index}`, 'gltf' ],
                ])
                vehicle.sceneTemplate = resources[resourceKey].scene
            }

            if(token !== this.switchToken)
                return

            // VisualVehicle reparents and edits parts from its model, so each
            // selection needs a fresh scene clone from the untouched template.
            const nextVisualVehicle = new VisualVehicle(cloneSkeleton(vehicle.sceneTemplate), vehicle)
            this.game.world.visualVehicle?.destroy()
            this.game.world.visualVehicle = nextVisualVehicle
            this.vehicleIndex = index
            this.game.physicalVehicle.setVehicleMode(vehicle.type)
            this.vehicleHint.textContent = vehicle.type === 'water'
                ? `${vehicle.name} · W/↑ forward · S/↓ reverse · A/D turn · C change`
                : `${vehicle.name} · ${vehicle.type === 'both' ? 'land & water' : 'land'} · C to change`
        }
        catch(error)
        {
            console.error(`Could not load the ${vehicle.name} car`, error)
            this.vehicleHint.textContent = `Could not load ${vehicle.name}`
        }
    }
}
