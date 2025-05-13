import * as THREE from 'https://unpkg.com/three@0.176.0/build/three.module.js';
import PaintingManager from './PaintingManager.js';

export default class Room3D {
  constructor(container, paintings, onReady) {
    // Scene setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.offsetWidth, container.offsetHeight);
    container.appendChild(this.renderer.domElement);

    // Store container reference for resize handling
    this.container = container;

    // Room properties
    this.roomDimensions = {
      width: 32,    // Left to right
      height: 16,   // Floor to ceiling
      depth: 16     // Front to back
    };
    this.maxPaintingSize = 4;
    this.textureLoader = new THREE.TextureLoader();

    // Track loading state
    this.isReady = false;
    this.onReady = onReady;
    this.loadingCount = 0;

    // Initialize painting manager
    this.paintingManager = new PaintingManager(this.scene, this.roomDimensions, this.maxPaintingSize);

    // Calculate optimal camera position based on room dimensions and FOV
    const optimalPosition = this.calculateOptimalCameraPosition();
    this.defaultCameraDistance = optimalPosition.distance;
    this.defaultCameraHeight = optimalPosition.height;

    // Default textures (you can change these URLs to your actual textures)
    this.roomTextures = {
      left: '/textures/wall.jpg',
      right: '/textures/wall.jpg',
      front: '/textures/wall.jpg',
      floor: '/textures/floor.jpg',
      ceiling: '/textures/ceiling.jpg'
    };

    this.currentFocus = null;

    // Camera state management
    this.currentCameraPosition = new THREE.Vector3(
      0,
      this.defaultCameraHeight,
      this.roomDimensions.depth/2 + this.defaultCameraDistance
    );
    this.currentCameraRotation = new THREE.Quaternion();
    this.desiredCameraPosition = this.currentCameraPosition.clone();
    this.desiredCameraRotation = new THREE.Quaternion();
    
    // Set initial camera state
    this.camera.position.copy(this.currentCameraPosition);
    this.camera.lookAt(0, 0, 0);
    this.currentCameraRotation.copy(this.camera.quaternion);
    this.desiredCameraRotation.copy(this.camera.quaternion);

    // Animation properties
    this.focusPositionSpeed = 0.05;
    this.focusRotationSpeed = 0.05;  // Equal to position speed during focus
    this.resetPositionSpeed = 0.01;
    this.resetRotationSpeed = 0.02;  // Double the position speed during reset
    this.resizeSpeed = 1; // Very fast speed for resize transitions
    this.currentPositionSpeed = this.resetPositionSpeed;
    this.currentRotationSpeed = this.resetRotationSpeed;

    // Create room and paintings
    this.setupRoom();
    
    // Load all paintings
    if (Array.isArray(paintings)) {
      this.loadingCount = paintings.length;
      paintings.forEach((paintingData, index) => {
        this.paintingManager.loadPainting(paintingData, index, () => {
          this.loadingCount--;
          if (this.loadingCount === 0) {
            this.isReady = true;
            if (this.onReady) this.onReady();
          }
        });
      });
    }

    // Bind methods
    this.animate = this.animate.bind(this);
    this.handleResize = this.handleResize.bind(this);

    // Add window resize listener
    window.addEventListener('resize', this.handleResize);

    // Start animation loop
    this.animate();
  }

  setupRoom() {
    const halfWidth = this.roomDimensions.width / 2;
    const halfHeight = this.roomDimensions.height / 2;
    const halfDepth = this.roomDimensions.depth / 2;
    
    // Adjust texture repeat based on wall dimensions
    const getTextureRepeat = (width, height) => ({
      x: Math.ceil(width / 5),   // 5 units per texture repeat
      y: Math.ceil(height / 5)
    });

    // Helper function to create a textured wall
    const createWall = (textureUrl, width, height, position, rotation) => {
      const texture = this.textureLoader.load(textureUrl);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      const repeat = getTextureRepeat(width, height);
      texture.repeat.set(repeat.x, repeat.y);

      const geometry = new THREE.PlaneGeometry(width, height);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.FrontSide
      });

      const wall = new THREE.Mesh(geometry, material);
      wall.position.copy(position);
      if (rotation) {
        wall.rotation.copy(rotation);
      }
      this.scene.add(wall);
      return wall;
    };

    // Create walls with different dimensions
    // Left wall
    createWall(
      this.roomTextures.left,
      this.roomDimensions.depth, this.roomDimensions.height, // depth x height
      new THREE.Vector3(-halfWidth, 0, 0),
      new THREE.Euler(0, Math.PI / 2, 0)
    );

    // Right wall
    createWall(
      this.roomTextures.right,
      this.roomDimensions.depth, this.roomDimensions.height, // depth x height
      new THREE.Vector3(halfWidth, 0, 0),
      new THREE.Euler(0, -Math.PI / 2, 0)
    );

    // Front wall
    createWall(
      this.roomTextures.front,
      this.roomDimensions.width, this.roomDimensions.height, // width x height
      new THREE.Vector3(0, 0, -halfDepth),
      new THREE.Euler(0, 0, 0)
    );

    // Floor
    createWall(
      this.roomTextures.floor,
      this.roomDimensions.width, this.roomDimensions.depth, // width x depth
      new THREE.Vector3(0, -halfHeight, 0),
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );

    // Ceiling
    createWall(
      this.roomTextures.ceiling,
      this.roomDimensions.width, this.roomDimensions.depth, // width x depth
      new THREE.Vector3(0, halfHeight, 0),
      new THREE.Euler(Math.PI / 2, 0, 0)
    );
  }

  animate() {
    requestAnimationFrame(this.animate);

    // Smoothly interpolate camera position
    this.camera.position.lerp(this.desiredCameraPosition, this.currentPositionSpeed);
    this.currentCameraPosition.copy(this.camera.position);

    // Smoothly interpolate camera rotation
    this.camera.quaternion.slerp(this.desiredCameraRotation, this.currentRotationSpeed);
    this.currentCameraRotation.copy(this.camera.quaternion);

    this.renderer.render(this.scene, this.camera);
  }

  focusOnPainting(id) {
    if (!this.isReady) {
      console.warn('Room3D: Cannot focus on painting before initialization is complete');
      return;
    }
    const painting = this.paintingManager.getPaintingById(id);
    if (!painting) return;

    this.currentFocus = painting.id;

    // Set to faster animation speeds for focusing
    this.currentPositionSpeed = this.focusPositionSpeed;
    this.currentRotationSpeed = this.focusRotationSpeed;

    const paintingPos = painting.mesh.position.clone();
    
    // Get painting dimensions from the geometry
    const geometry = painting.mesh.geometry;
    const paintingWidth = geometry.parameters.width;
    const paintingHeight = geometry.parameters.height;

    // Calculate optimal distance based on painting size and camera FOV
    const fov = this.camera.fov * (Math.PI / 180); // Convert FOV to radians
    // Use the larger dimension to ensure whole painting is visible
    const maxDimension = Math.max(paintingWidth, paintingHeight);
    // Add 20% padding around the painting
    const padding = 1.2;
    // Calculate distance needed to fit the painting in view
    const optimalDistance = (maxDimension * padding) / (2 * Math.tan(fov / 2));

    // Calculate offset using the optimal distance
    const offset = this.calculatePaintingOffset(painting.mesh.rotation.y, optimalDistance);
    
    // Set desired camera position
    this.desiredCameraPosition.copy(paintingPos).add(offset);
    this.desiredCameraPosition.y = paintingPos.y;

    // Calculate and set desired rotation
    const m = new THREE.Matrix4().lookAt(
      this.desiredCameraPosition,
      paintingPos,
      new THREE.Vector3(0, 1, 0)
    );
    this.desiredCameraRotation.setFromRotationMatrix(m);
  }

  calculatePaintingOffset(rotationY, distance) {
    const offset = new THREE.Vector3();
    
    switch (rotationY) {
      case Math.PI / 2: // Left wall
        offset.set(distance, 0, 0);
        break;
      case -Math.PI / 2: // Right wall
        offset.set(-distance, 0, 0);
        break;
      case 0: // Front wall
        offset.set(0, 0, distance);
        break;
    }
    
    return offset;
  }

  resetCamera() {
    this.currentFocus = null;

    // Set to slower animation speeds for resetting
    this.currentPositionSpeed = this.resetPositionSpeed;
    this.currentRotationSpeed = this.resetRotationSpeed;
    
    // Recalculate optimal camera position in case window was resized
    const optimalPosition = this.calculateOptimalCameraPosition();
    
    // Reset to default position
    this.desiredCameraPosition.set(
      0,
      optimalPosition.height,
      this.roomDimensions.depth/2 + optimalPosition.distance
    );
    
    // Calculate default rotation (looking into room)
    const m = new THREE.Matrix4().lookAt(
      this.desiredCameraPosition,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0)
    );
    this.desiredCameraRotation.setFromRotationMatrix(m);
  }

  // Helper method to calculate optimal camera position
  calculateOptimalCameraPosition() {
    const fovRadians = (75 * Math.PI) / 180;
    const viewportWidth = this.renderer.domElement.width;
    const viewportHeight = this.renderer.domElement.height;
    const viewportRatio = viewportWidth / viewportHeight;
    const roomRatio = this.roomDimensions.width / this.roomDimensions.height;

    let distance;

    if (roomRatio > viewportRatio) {
      // Room is wider than viewport (relative to their heights)
      // Fit to height to ensure floor/ceiling are flush with viewport
      const halfHeight = this.roomDimensions.height / 2;
      const tanHalfFov = Math.tan(fovRadians / 2);
      distance = halfHeight / tanHalfFov;
    } else {
      // Room is taller than viewport (relative to their widths)
      // Fit to width to ensure walls are flush with viewport
      const halfWidth = this.roomDimensions.width / 2;
      const tanHalfFov = Math.tan(fovRadians / 2);
      distance = halfWidth / (tanHalfFov * viewportRatio);
    }

    // Add some logging to debug the calculations
    console.log('Ratios:', {
      viewport: viewportRatio,
      room: roomRatio,
      fittingToHeight: roomRatio > viewportRatio
    });
    console.log('Calculated distance:', distance);

    return {
      distance: distance,
      height: 0
    };
  }

  handleResize() {
    // Update renderer size
    this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
    
    // Reset FOV to default
    this.camera.fov = 75;
    
    // Update camera aspect ratio
    this.camera.aspect = this.container.offsetWidth / this.container.offsetHeight;
    
    // Recalculate optimal camera position
    const optimalPosition = this.calculateOptimalCameraPosition();
    
    // If we're at the default view (not focused on a painting), update desired position
    const distanceToOrigin = new THREE.Vector3(0, 0, 0).distanceTo(this.desiredCameraPosition);
    const defaultDistance = this.roomDimensions.depth/2 + optimalPosition.distance;
    const isAtDefaultView = Math.abs(distanceToOrigin - defaultDistance) < 0.1;
    
    if (this.currentFocus === null) {
      // Temporarily increase animation speeds for resize
      this.currentPositionSpeed = this.resizeSpeed;
      this.currentRotationSpeed = this.resizeSpeed;
      
      // Reset speeds after a short delay
      setTimeout(() => {
        this.currentPositionSpeed = this.resetPositionSpeed;
        this.currentRotationSpeed = this.resetRotationSpeed;
      }, 100);
    }

    // Update camera projection
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    // Remove event listeners when cleaning up
    window.removeEventListener('resize', this.handleResize);
  }
} 