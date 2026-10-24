import * as THREE from 'three/webgpu'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { Game } from '../Game.js'

export class Wildlife
{
    constructor()
    {
        this.game = Game.getInstance()
        this.randomSeed = 0x41a71
        this.fish = []
        this.monsters = []
        this.monsterPositions = []
        this.time = 0

        this.load()
    }

    random()
    {
        this.randomSeed = (this.randomSeed * 1664525 + 1013904223) >>> 0
        return this.randomSeed / 0x100000000
    }

    async load()
    {
        try
        {
            const resources = await this.game.resourcesLoader.load([
                [ 'monsterPack', 'wildlife/ultimate-monsters-pack.glb', 'gltf' ],
                [ 'animatedFish', 'wildlife/fish-low-poly-rigged-animated.glb', 'gltf' ],
            ])

            this.prepareTerrainData()
            this.addMonsters(resources.monsterPack.scene, resources.monsterPack.animations)
            this.addFish(resources.animatedFish.scene, resources.animatedFish.animations)

            this.tickCallback = () => this.update()
            this.game.ticker.events.on('tick', this.tickCallback, 7.2)
        }
        catch(error)
        {
            console.error('Could not load the wildlife models', error)
        }
    }

    prepareTerrainData()
    {
        const texture = this.game.resources.terrainTexture
        const image = texture?.image || texture?.source?.data || texture?.mipmaps?.[0]

        if(image?.data && image.width && image.height)
        {
            const channels = image.data.length / (image.width * image.height)
            this.waterMap = { data: image.data, width: image.width, height: image.height, channels }
        }
        else if(image?.width && image?.height)
        {
            try
            {
                const canvas = document.createElement('canvas')
                canvas.width = image.width
                canvas.height = image.height
                const context = canvas.getContext('2d', { willReadFrequently: true })
                context.drawImage(image, 0, 0, image.width, image.height)
                this.waterMap = {
                    data: context.getImageData(0, 0, image.width, image.height).data,
                    width: image.width,
                    height: image.height,
                    channels: 4,
                }
            }
            catch(error)
            {
                console.warn('Wildlife will use terrain height to avoid water.', error)
            }
        }

        const terrainGeometry = this.game.world.floor?.geometry
        this.terrainPositions = terrainGeometry?.attributes?.position
        this.terrainRows = this.terrainPositions ? Math.round(Math.sqrt(this.terrainPositions.count)) : 0
        this.terrainSize = this.game.terrain.size
    }

    sampleWater(x, z)
    {
        if(x < -this.terrainSize / 2 || x >= this.terrainSize / 2 || z < -this.terrainSize / 2 || z >= this.terrainSize / 2)
            return false

        if(this.waterMap)
        {
            const { data, width, height, channels } = this.waterMap
            const px = Math.floor((x / this.terrainSize + 0.5) * width)
            // The terrain texture is uploaded with flipY=false. Its GPU UV v
            // axis therefore runs opposite to the top-to-bottom image rows.
            const py = Math.floor((0.5 - z / this.terrainSize) * height)
            const blueSample = data[(py * width + px) * channels + 2]
            const blue = data instanceof Uint8Array || data instanceof Uint8ClampedArray
                ? blueSample / 255
                : blueSample
            return blue > 0.17
        }

        return this.sampleGroundHeight(x, z) <= (this.game.water?.surfaceElevation ?? -0.3) + 0.35
    }

    sampleGroundHeight(x, z)
    {
        if(!this.terrainPositions || !this.terrainRows)
            return 0

        const max = this.terrainRows - 1
        const halfExtent = this.terrainSize / 2
        const ix = Math.max(0, Math.min(max, Math.round((x / (halfExtent * 2) + 0.5) * max)))
        const iz = Math.max(0, Math.min(max, Math.round((z / (halfExtent * 2) + 0.5) * max)))
        const index = (iz + ix * this.terrainRows) * 3 + 1
        return this.terrainPositions.getY(index) || 0
    }

    findPosition(type, near = null, minDistance = 0, maxDistance = Infinity)
    {
        for(let attempt = 0; attempt < 2400; attempt++)
        {
            const x = this.random() * (this.terrainSize - 28) - (this.terrainSize - 28) / 2
            const z = this.random() * (this.terrainSize - 28) - (this.terrainSize - 28) / 2

            if(type === 'land' && this.sampleWater(x, z))
                continue
            if(type === 'water' && !this.sampleWater(x, z))
                continue
            if(type === 'land' && !near && Math.hypot(x, z) < 15)
                continue
            if(near)
            {
                const distance = Math.hypot(x - near.x, z - near.z)
                if(distance < minDistance || distance > maxDistance)
                    continue
            }
            if(type === 'land' && this.monsterPositions.some((monster) => Math.hypot(x - monster.x, z - monster.z) < 7))
                continue

            return new THREE.Vector3(x, this.sampleGroundHeight(x, z), z)
        }

        return null
    }

    addMonsters(scene, animations)
    {
        const pack = scene.getObjectByName('Root') || scene
        const creatures = [ ...pack.children ]
        scene.updateMatrixWorld(true)
        const sourceRoot = scene.getObjectByName('Sketchfab_model') || scene
        const sourceOrientation = sourceRoot.getWorldQuaternion(new THREE.Quaternion())
        const sourceScale = sourceRoot.getWorldScale(new THREE.Vector3())
        const spawn = this.game.respawns?.getDefault()?.position || new THREE.Vector3()

        for(const creature of creatures)
        {
            const position = this.monsters.length < 8
                ? this.findPosition('land', spawn, 5, 17) || this.findPosition('land')
                : this.findPosition('land')
            if(!position)
                break

            // The pack's root rotates its Z-up artwork into Three.js Y-up.
            // Place each creature under a matching orientation at world level
            // so terrain coordinates stay correct and the models stand upright.
            pack.remove(creature)
            creature.position.set(0, 0, 0)
            const anchor = new THREE.Group()
            anchor.name = `${creature.name} terrain anchor`
            const orientedModel = new THREE.Group()
            orientedModel.quaternion.copy(sourceOrientation)
            orientedModel.scale.copy(sourceScale)
            anchor.add(orientedModel)
            orientedModel.add(creature)
            scene.add(anchor)

            scene.updateMatrixWorld(true)
            const bounds = new THREE.Box3().setFromObject(creature)
            const size = bounds.getSize(new THREE.Vector3())
            const height = Math.max(size.y, 0.001)
            const targetHeight = 1.25 + this.random() * 0.85
            const scaleFactor = targetHeight / height
            creature.scale.multiplyScalar(scaleFactor)

            anchor.rotation.y = this.random() * Math.PI * 2
            scene.updateMatrixWorld(true)
            const groundedBounds = new THREE.Box3().setFromObject(creature)
            anchor.position.set(position.x, position.y - groundedBounds.min.y, position.z)
            creature.castShadow = false
            creature.userData.wildlifeLabel = creature.name
            this.monsters.push(creature)
            this.monsterPositions.push(position)
        }

        this.game.scene.add(scene)
        if(animations?.length)
        {
            this.monsterMixer = new THREE.AnimationMixer(scene)
            this.monsterMixer.clipAction(animations[0]).play()
        }
    }

    addFish(template, animations)
    {
        const sourceBounds = new THREE.Box3().setFromObject(template)
        const size = sourceBounds.getSize(new THREE.Vector3())
        const longestAxis = size.x >= size.y && size.x >= size.z ? 'x' : size.z >= size.y ? 'z' : 'y'
        const targetLength = 0.95
        const fitScale = targetLength / Math.max(size.x, size.y, size.z, 0.001)
        const center = sourceBounds.getCenter(new THREE.Vector3()).multiplyScalar(fitScale)
        const count = 28
        const surface = this.game.water?.surfaceElevation ?? -0.3
        const spawn = this.game.respawns?.getDefault()?.position || new THREE.Vector3()
        const nearbyWater = this.findPosition('water', spawn, 8, 35)

        // Give the fish a little bioluminescent color so they read through the
        // water details and low-light palette without changing their textures.
        template.traverse((object) =>
        {
            if(!object.isMesh)
                return

            const materials = Array.isArray(object.material) ? object.material : [ object.material ]
            for(const material of materials)
            {
                if(material?.emissive)
                {
                    material.emissive.set(0x087f9c)
                    material.emissiveIntensity = 0.55
                    material.needsUpdate = true
                }
            }
        })

        for(let index = 0; index < count; index++)
        {
            const position = index < 12 && nearbyWater
                ? this.findPosition('water', nearbyWater, 2, 14) || this.findPosition('water', spawn, 8, 35) || this.findPosition('water')
                : this.findPosition('water')
            if(!position)
                break

            const model = cloneSkeleton(template)
            model.scale.setScalar(fitScale)
            model.position.copy(center).negate()

            const orientation = new THREE.Group()
            if(longestAxis === 'z')
                orientation.rotation.y = Math.PI / 2
            else if(longestAxis === 'y')
                orientation.rotation.z = -Math.PI / 2
            orientation.add(model)

            const swimmer = new THREE.Group()
            swimmer.name = `Animated fish ${index + 1}`
            swimmer.add(orientation)
            const seabed = this.sampleGroundHeight(position.x, position.z)
            const waterColumn = Math.max(0.12, surface - seabed)
            const depth = Math.min(0.16 + this.random() * 0.12, Math.max(0.08, waterColumn - 0.12))
            swimmer.position.set(position.x, surface - depth, position.z)
            swimmer.rotation.y = this.random() * Math.PI * 2
            this.game.scene.add(swimmer)

            const fish = {
                object: swimmer,
                mixer: animations?.length ? new THREE.AnimationMixer(model) : null,
                speed: 1 + this.random() * 1.4,
                phase: this.random() * Math.PI * 2,
                depth,
                surfaceOffset: index < 12 && index % 2 === 0 ? 0.27 : 0,
                target: null,
            }
            if(fish.mixer)
            {
                fish.mixer.clipAction(animations[0]).play()
                fish.mixer.setTime(this.random() * animations[0].duration)
            }
            fish.target = this.findPosition('water', position, 8, 24)
            this.fish.push(fish)
        }
    }

    update()
    {
        const delta = Math.min(this.game.ticker.deltaScaled, 0.05)
        this.time += delta
        this.monsterMixer?.update(delta)

        const surface = this.game.water?.surfaceElevation ?? -0.3
        for(const fish of this.fish)
        {
            fish.mixer?.update(delta)

            const position = fish.object.position
            const targetDistance = fish.target ? Math.hypot(position.x - fish.target.x, position.z - fish.target.z) : Infinity
            if(!fish.target || targetDistance < 2)
                fish.target = this.findPosition('water', position, 8, 24) || this.findPosition('water')

            if(fish.target)
            {
                const dx = fish.target.x - position.x
                const dz = fish.target.z - position.z
                const desiredHeading = Math.atan2(dz, dx)
                const turn = Math.atan2(Math.sin(desiredHeading - fish.object.rotation.y), Math.cos(desiredHeading - fish.object.rotation.y))
                fish.object.rotation.y += Math.max(-delta * 0.7, Math.min(delta * 0.7, turn))

                const nextX = position.x + Math.cos(fish.object.rotation.y) * fish.speed * delta
                const nextZ = position.z + Math.sin(fish.object.rotation.y) * fish.speed * delta
                if(this.sampleWater(nextX, nextZ))
                {
                    position.x = nextX
                    position.z = nextZ
                }
                else
                {
                    fish.target = this.findPosition('water', position, 6, 20) || this.findPosition('water')
                    fish.object.rotation.y += delta * (fish.phase % 2 ? 0.9 : -0.9)
                }
            }

            const seabed = this.sampleGroundHeight(position.x, position.z)
            const maxDepth = Math.max(0.08, surface - seabed - 0.12)
            fish.depth = Math.min(fish.depth, maxDepth)
            // A third of the school swims through the waterline so the fish
            // remain visible from the normal overhead camera; the rest stay
            // submerged at the same seabed-safe depth.
            position.y = surface - fish.depth + fish.surfaceOffset + Math.sin(this.time * 1.8 + fish.phase) * 0.035
        }
    }
}
