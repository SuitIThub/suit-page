import * as THREE from 'https://unpkg.com/three@0.176.0/build/three.module.js';

export default class PaintingManager {
  constructor(scene, roomDimensions, maxPaintingSize) {
    this.scene = scene;
    this.roomDimensions = roomDimensions;
    this.maxPaintingSize = maxPaintingSize;
    this.paintings = [];
    this.usedPositions = [];
    this.textureLoader = new THREE.TextureLoader();
  }

  loadPainting(paintingData, id, onLoaded) {
    this.textureLoader.load(paintingData.url, (texture) => {
      // Calculate aspect ratio and dimensions
      const aspectRatio = texture.image.width / texture.image.height;
      let width, height;
      
      if (aspectRatio > 1) {
        // Landscape orientation
        width = this.maxPaintingSize;
        height = width / aspectRatio;
      } else {
        // Portrait orientation
        height = this.maxPaintingSize;
        width = height * aspectRatio;
      }

      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({ 
        map: texture,
        side: THREE.DoubleSide 
      });
      const mesh = new THREE.Mesh(geometry, material);

      // Position the painting
      const position = this.calculatePaintingPosition(id);
      mesh.position.copy(position.position);
      mesh.rotation.y = position.rotation;
      mesh.userData = { 
        id,
        title: paintingData.title || `Painting ${id}`,
        description: paintingData.description || ''
      };

      this.paintings.push({ id, mesh });
      this.scene.add(mesh);
      
      // Call the onLoaded callback if provided
      if (onLoaded) onLoaded();
    });
  }

  calculatePaintingPosition(id) {
    // Constants for positioning
    const halfWidth = this.roomDimensions.width / 2 - 0.05;
    const halfDepth = this.roomDimensions.depth / 2 - 0.05;
    const wallHeight = this.roomDimensions.height * 0.25; // Keep consistent height
    const minSpacing = this.maxPaintingSize * 1.5; // Minimum gap between paintings
    
    // Calculate safe boundaries accounting for painting size
    // Add a small extra buffer (0.1) to ensure paintings don't touch the edges
    const paintingHalfSize = this.maxPaintingSize / 2 + 0.1;
    const safeWidth = this.roomDimensions.width - (paintingHalfSize * 2);
    const safeDepth = this.roomDimensions.depth - (paintingHalfSize * 2);

    // Calculate camera exclusion zone
    const cameraZ = this.roomDimensions.depth/2 + this.maxPaintingSize * 4; // Rough estimate of camera distance
    const cameraExclusionRadius = this.maxPaintingSize * 2;

    // Function to check if a position is too close to the camera
    const isTooCloseToCamera = (x, z) => {
      const dx = x - 0;
      const dz = z - cameraZ;
      const distanceToCamera = Math.sqrt(dx * dx + dz * dz);
      return distanceToCamera < cameraExclusionRadius;
    };

    // Function to check if a position is within safe bounds
    const isWithinBounds = (x, z, wall) => {
      switch (wall) {
        case 0: // left wall
        case 1: // right wall
          return Math.abs(z) <= (safeDepth / 2);
        case 2: // front wall
          return Math.abs(x) <= (safeWidth / 2);
        default:
          return false;
      }
    };

    // Function to check if a position is too close to existing paintings
    const isTooClose = (x, z, wall) => {
      // First check camera distance
      if (isTooCloseToCamera(x, z)) {
        return true;
      }

      // Check if position is within bounds
      if (!isWithinBounds(x, z, wall)) {
        return true;
      }

      return this.usedPositions.some(pos => {
        if (pos.wall !== wall) return false;
        
        // Calculate distance based on wall orientation
        let distance;
        if (wall === 0 || wall === 1) { // Side walls
          distance = Math.abs(z - pos.z);
        } else { // Front wall
          distance = Math.abs(x - pos.x);
        }
        return distance < minSpacing;
      });
    };

    // Function to get random position on a wall
    const getRandomPosition = (wall) => {
      let x = 0, z = 0, rotY = 0;
      let maxAttempts = 50;
      let validPosition = false;
      
      while (!validPosition && maxAttempts > 0) {
        switch (wall) {
          case 0: // left wall
            x = -halfWidth;
            z = Math.random() * safeDepth - (safeDepth / 2);
            rotY = Math.PI / 2;
            break;
          case 1: // right wall
            x = halfWidth;
            z = Math.random() * safeDepth - (safeDepth / 2);
            rotY = -Math.PI / 2;
            break;
          case 2: // front wall
            z = -halfDepth;
            // Avoid center area more aggressively for front wall
            const centerExclusion = this.maxPaintingSize * 3;
            const availableWidth = (safeWidth / 2) - centerExclusion;
            const leftSide = Math.random() < 0.5;
            
            if (leftSide) {
              x = Math.random() * availableWidth - (safeWidth / 2);
            } else {
              x = Math.random() * availableWidth + centerExclusion;
            }
            rotY = 0;
            break;
        }
        
        validPosition = !isTooClose(x, z, wall);
        maxAttempts--;
      }
      
      return { x, z, rotY, valid: validPosition };
    };

    // Try to find a valid position on a random wall
    let position = null;
    let attempts = 20;
    
    while (!position && attempts > 0) {
      const wall = Math.floor(Math.random() * 3);
      const result = getRandomPosition(wall);
      
      if (result.valid) {
        position = result;
        this.usedPositions.push({
          wall,
          x: result.x,
          z: result.z
        });
      }
      attempts--;
    }

    // If no valid position found, use fallback positioning
    if (!position) {
      console.warn('Could not find valid random position, using fallback');
      // Modified fallback to ensure it's within bounds
      position = {
        x: -halfWidth,
        z: -safeDepth/2 + (id * minSpacing) % (safeDepth - paintingHalfSize),
        rotY: Math.PI / 2
      };
    }

    return {
      position: new THREE.Vector3(position.x, wallHeight, position.z),
      rotation: position.rotY
    };
  }

  getPaintingById(id) {
    return this.paintings.find(p => p.id === id);
  }
} 