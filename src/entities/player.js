import * as THREE from 'three'
import { createPlayerMaterial } from '../materials/player.js'

const geometry = new THREE.BoxGeometry(1, 1, 1)

export function createPlayer() {
  const mesh = new THREE.Mesh(geometry, createPlayerMaterial())
  mesh.name = 'player'
  mesh.position.y = 0.5
  mesh.update = (dt) => (mesh.rotation.y += dt)
  return mesh
}
