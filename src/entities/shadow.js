import * as THREE from 'three'
import { createShadowMaterial, disposeShadowMaterial } from '../materials/shadow.js'

/** Hauteur du corps rapportée à son rayon : une ombre basse, posée sur le sol. */
const BODY_HEIGHT = 0.58

/** Durées et amplitudes du rebond d'impact, réglées pour rester feutrées. */
const HIT_DURATION = 0.12
const HIT_SQUASH = 0.22
const HIT_WIDEN = 0.09
const HIT_GLOW = 0.6

/** Fondu de mort : disparition complète en moins de 0,3 s. */
const DEATH_DURATION = 0.28

/** Teinte du flash d'impact : le rose danger de la DA, en émissif doux. */
const HIT_GLOW_COLOR = '#e8907f'

/** Yeux clairs : blanc chaud, sans éclairage, lisibles même sur petit écran. */
const EYE_COLOR = '#fdf6e3'

/**
 * Ombre hostile : petite masse ronde et basse, deux yeux clairs à l'avant (-Z).
 * Le groupe est posé à l'origine au sol ; l'appelant pilote `position` et
 * l'orientation. Rien n'est alloué après la construction.
 * @param {{ radius?: number }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   playHit(): void,
 *   playDeath(): void,
 *   update(dt: number): void,
 *   dispose(): void,
 * }}
 */
export function createShadow({ radius = 0.35 } = {}) {
  const size = Number.isFinite(radius) && radius > 0 ? radius : 0.35

  const group = new THREE.Group()
  group.name = 'shadow'
  group.userData = { radius: size }

  const material = createShadowMaterial()
  material.emissive.set(HIT_GLOW_COLOR)

  const bodyGeometry = new THREE.SphereGeometry(1, 14, 8)
  const body = new THREE.Mesh(bodyGeometry, material)
  body.name = 'shadow-body'
  body.scale.set(size, size * BODY_HEIGHT, size)
  body.position.y = size * BODY_HEIGHT
  body.castShadow = false
  body.receiveShadow = false
  group.add(body)

  const eyeGeometry = new THREE.SphereGeometry(1, 6, 4)
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE_COLOR, toneMapped: false })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial)
    eye.name = side < 0 ? 'shadow-eye-left' : 'shadow-eye-right'
    eye.scale.set(size * 0.14, size * 0.18, size * 0.07)
    eye.position.set(side * size * 0.3, size * 0.72, -size * 0.92)
    eye.castShadow = false
    eye.receiveShadow = false
    group.add(eye)
  }

  let hitTime = -1
  let deathTime = -1
  let dead = false
  let disposed = false

  /** Rebond d'impact : écrasement bref et flash émissif, relançable à zéro. */
  function playHit() {
    if (dead || deathTime >= 0) return
    hitTime = 0
  }

  /** Réduction d'échelle jusqu'à disparition ; l'état mort ne se réanime pas. */
  function playDeath() {
    if (dead) return
    hitTime = -1
    deathTime = 0
    group.scale.set(1, 1, 1)
    material.emissiveIntensity = 0
    group.visible = true
  }

  /** Anime l'impact ou la mort ; au repos, ne touche ni transform ni matériau. */
  function update(dt) {
    if (dead || dt <= 0) return

    if (deathTime >= 0) {
      deathTime += dt
      const progress = deathTime >= DEATH_DURATION ? 1 : deathTime / DEATH_DURATION
      const remaining = 1 - progress * progress
      group.scale.set(remaining, remaining, remaining)
      if (progress >= 1) {
        group.visible = false
        dead = true
      }
      return
    }

    if (hitTime < 0) return
    hitTime += dt
    const progress = hitTime >= HIT_DURATION ? 1 : hitTime / HIT_DURATION
    const wave = Math.sin(Math.PI * progress)
    group.scale.set(1 + HIT_WIDEN * wave, 1 - HIT_SQUASH * wave, 1 + HIT_WIDEN * wave)
    material.emissiveIntensity = HIT_GLOW * wave
    if (progress >= 1) {
      hitTime = -1
      group.scale.set(1, 1, 1)
      material.emissiveIntensity = 0
    }
  }

  /** Libère les géométries et matériaux possédés ; idempotent. */
  function dispose() {
    if (disposed) return
    disposed = true
    bodyGeometry.dispose()
    eyeGeometry.dispose()
    disposeShadowMaterial(material)
    eyeMaterial.dispose()
  }

  return { group, playHit, playDeath, update, dispose }
}
