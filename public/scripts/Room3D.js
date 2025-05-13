import * as THREE from "https://unpkg.com/three@0.176.0/build/three.module.js";
import PaintingManager from "./PaintingManager.js";
import { debug } from './debug.js';

export default class Room3D {
  constructor(container, paintings, onReady) {
    // Scene setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.offsetWidth / container.offsetHeight,
      0.1,
      1000
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.offsetWidth, container.offsetHeight);
    container.appendChild(this.renderer.domElement);

    // Store container reference for resize handling
    this.container = container;

    // Setup raycaster for painting interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.onPaintingClick = null;

    // Add click event listener
    this.renderer.domElement.addEventListener('click', this.handleClick.bind(this));

    // Initialize texture loader
    this.textureLoader = new THREE.TextureLoader();

    // Initialize painting manager
    this.paintingManager = new PaintingManager(this.scene);

    // Track loading state
    this.isReady = false;
    this.onReady = onReady;

    // Default textures
    this.roomTextures = {
      left: "/textures/wall.jpg",
      right: "/textures/wall.jpg",
      front: "/textures/wall.jpg",
      floor: "/textures/floor.jpg",
      ceiling: "/textures/ceiling.jpg",
    };

    // Camera state management
    this.currentFocus = null;
    this.currentCameraPosition = new THREE.Vector3();
    this.currentCameraRotation = new THREE.Quaternion();
    this.desiredCameraPosition = new THREE.Vector3();
    this.desiredCameraRotation = new THREE.Quaternion();

    // Animation properties
    this.focusPositionSpeed = 0.05;
    this.focusRotationSpeed = 0.05;
    this.resetPositionSpeed = 0.01;
    this.resetRotationSpeed = 0.02;
    this.resizeSpeed = 1;
    this.currentPositionSpeed = this.resetPositionSpeed;
    this.currentRotationSpeed = this.resetRotationSpeed;

    // Bind methods
    this.animate = this.animate.bind(this);
    this.handleResize = this.handleResize.bind(this);

    // Add window resize listener
    window.addEventListener("resize", this.handleResize);

    // Start the initialization process
    if (Array.isArray(paintings)) {
      this.initializeRoom(paintings);
    }

    // Start animation loop
    this.animate();
  }

  async initializeRoom(paintings) {
    try {
      // First, load all paintings without positioning them
      const loadedPaintings = await Promise.all(
        paintings.map((paintingData, index) => 
          this.paintingManager.loadPainting(paintingData, index)
        )
      );

      // Calculate total space needed and arrange paintings
      const totalSpace = this.calculateTotalSpaceNeeded(loadedPaintings);

      // Now calculate room dimensions based on the arranged paintings
      this.roomDimensions = this.calculateRoomDimensions(totalSpace);

      // Create the room with the calculated dimensions
      this.setupRoom();

      // Position all paintings
      this.positionPaintings(loadedPaintings);

      // Calculate optimal camera position based on room dimensions and FOV
      const optimalPosition = this.calculateOptimalCameraPosition();
      this.defaultCameraDistance = optimalPosition.distance;
      this.defaultCameraHeight = optimalPosition.height;

      // Set initial camera position
      this.currentCameraPosition = new THREE.Vector3(
        0,
        this.defaultCameraHeight,
        this.roomDimensions.depth / 2 + this.defaultCameraDistance
      );
      this.currentCameraRotation = new THREE.Quaternion();
      this.desiredCameraPosition = this.currentCameraPosition.clone();
      this.desiredCameraRotation = new THREE.Quaternion();

      // Set initial camera state
      this.camera.position.copy(this.currentCameraPosition);
      this.camera.lookAt(0, 0, 0);
      this.currentCameraRotation.copy(this.camera.quaternion);
      this.desiredCameraRotation.copy(this.camera.quaternion);

      // Mark as ready and call callback
      this.isReady = true;
      if (this.onReady) this.onReady();

    } catch (error) {
      console.error('Error initializing room:', error);
    }
  }

  calculateTotalSpaceNeeded(paintings) {
    let totalLeftWallWidth = 0;
    let totalFrontWallWidth = 0;
    let maxHeight = 0;

    // Calculate total width of paintings on each wall
    const paintingsWithSizes = paintings.map(painting => {
      const size = this.paintingManager.calculatePaintingCompositionSize(painting.mesh);
      return {
        painting,
        size,
        area: size.width * size.height
      };
    });

    // Shuffle all paintings randomly
    const shuffledPaintings = [...paintingsWithSizes];
    for (let i = shuffledPaintings.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledPaintings[i], shuffledPaintings[j]] = [shuffledPaintings[j], shuffledPaintings[i]];
    }

    // Split paintings evenly between walls
    const leftWallPaintings = shuffledPaintings.slice(0, Math.ceil(shuffledPaintings.length / 2));
    const frontWallPaintings = shuffledPaintings.slice(Math.ceil(shuffledPaintings.length / 2));

    // Reset totals before final calculation
    totalLeftWallWidth = 0;
    totalFrontWallWidth = 0;
    maxHeight = 0;

    // Calculate final dimensions and assign walls
    leftWallPaintings.forEach((item) => {
      const { painting, size } = item;
      maxHeight = Math.max(maxHeight, size.height);
      painting.targetWall = 'left';
      totalLeftWallWidth += size.width;
    });

    frontWallPaintings.forEach((item) => {
      const { painting, size } = item;
      maxHeight = Math.max(maxHeight, size.height);
      painting.targetWall = 'front';
      totalFrontWallWidth += size.width;
    });

    // Replace the original paintings array with the new shuffled order
    paintings.splice(0, paintings.length, 
      ...leftWallPaintings.map(item => item.painting),
      ...frontWallPaintings.map(item => item.painting)
    );

    return {
      leftWallWidth: totalLeftWallWidth,
      frontWallWidth: totalFrontWallWidth,
      maxHeight: maxHeight
    };
  }

  calculateRoomDimensions(totalSpace) {
    const WALL_PADDING = 2; // 2 meters padding on each wall
    const MIN_ROOM_SIZE = 16; // Minimum room size in meters

    // Calculate initial dimensions (doubled as before)
    let depth = Math.max(MIN_ROOM_SIZE, (totalSpace.leftWallWidth + WALL_PADDING * 2) * 2);
    let width = Math.max(MIN_ROOM_SIZE, (totalSpace.frontWallWidth + WALL_PADDING * 2) * 2);
    const height = Math.max(MIN_ROOM_SIZE / 2, totalSpace.maxHeight * 2);

    // Ensure width is at least 2/3 of depth
    const minWidthFromDepth = depth * (4/5);
    width = Math.max(width, minWidthFromDepth);

    return {
      width,
      height,
      depth
    };
  }

  positionPaintings(paintings) {
    const WALL_OFFSET = 0.01; // 1cm offset from wall to prevent clipping

    // Separate paintings by wall
    const leftWallPaintings = paintings.filter(p => p.targetWall === 'left');
    const frontWallPaintings = paintings.filter(p => p.targetWall === 'front');

    // Calculate total width of paintings on each wall
    const leftWallTotalWidth = leftWallPaintings.reduce((sum, p) => 
      sum + this.paintingManager.calculatePaintingCompositionSize(p.mesh).width, 0);
    const frontWallTotalWidth = frontWallPaintings.reduce((sum, p) => 
      sum + this.paintingManager.calculatePaintingCompositionSize(p.mesh).width, 0);

    // Calculate spacing between paintings
    const leftWallSpacing = (this.roomDimensions.depth - leftWallTotalWidth) / (leftWallPaintings.length + 1);
    const frontWallSpacing = (this.roomDimensions.width - frontWallTotalWidth) / (frontWallPaintings.length + 1);

    // Position paintings on left wall
    let currentLeftOffset = -this.roomDimensions.depth / 2 + leftWallSpacing; // Start after first spacing
    leftWallPaintings.forEach(painting => {
      const size = this.paintingManager.calculatePaintingCompositionSize(painting.mesh);
      const position = new THREE.Vector3(
        -this.roomDimensions.width / 2 + WALL_OFFSET, // Slightly in front of left wall
        0,
        currentLeftOffset + size.width / 2
      );
      this.paintingManager.positionPainting(painting, position, Math.PI / 2);
      currentLeftOffset += size.width + leftWallSpacing;
    });

    // Position paintings on front wall
    let currentFrontOffset = -this.roomDimensions.width / 2 + frontWallSpacing; // Start after first spacing
    frontWallPaintings.forEach(painting => {
      const size = this.paintingManager.calculatePaintingCompositionSize(painting.mesh);
      const position = new THREE.Vector3(
        currentFrontOffset + size.width / 2,
        0,
        -this.roomDimensions.depth / 2 + WALL_OFFSET // Slightly in front of front wall
      );
      this.paintingManager.positionPainting(painting, position, 0);
      currentFrontOffset += size.width + frontWallSpacing;
    });
  }

  setupRoom() {
    const halfWidth = this.roomDimensions.width / 2;
    const halfHeight = this.roomDimensions.height / 2;
    const halfDepth = this.roomDimensions.depth / 2;

    // Adjust texture repeat based on wall dimensions
    const getTextureRepeat = (width, height) => ({
      x: Math.ceil(width / 5), // 5 units per texture repeat
      y: Math.ceil(height / 5),
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
        side: THREE.FrontSide,
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
      this.roomDimensions.depth,
      this.roomDimensions.height, // depth x height
      new THREE.Vector3(-halfWidth, 0, 0),
      new THREE.Euler(0, Math.PI / 2, 0)
    );

    // Right wall
    createWall(
      this.roomTextures.right,
      this.roomDimensions.depth,
      this.roomDimensions.height, // depth x height
      new THREE.Vector3(halfWidth, 0, 0),
      new THREE.Euler(0, -Math.PI / 2, 0)
    );

    // Front wall
    createWall(
      this.roomTextures.front,
      this.roomDimensions.width,
      this.roomDimensions.height, // width x height
      new THREE.Vector3(0, 0, -halfDepth),
      new THREE.Euler(0, 0, 0)
    );

    // Floor
    createWall(
      this.roomTextures.floor,
      this.roomDimensions.width,
      this.roomDimensions.depth, // width x depth
      new THREE.Vector3(0, -halfHeight, 0),
      new THREE.Euler(-Math.PI / 2, 0, 0)
    );

    // Ceiling
    createWall(
      this.roomTextures.ceiling,
      this.roomDimensions.width,
      this.roomDimensions.depth, // width x depth
      new THREE.Vector3(0, halfHeight, 0),
      new THREE.Euler(Math.PI / 2, 0, 0)
    );
  }

  animate() {
    requestAnimationFrame(this.animate);

    // Smoothly interpolate camera position
    this.camera.position.lerp(
      this.desiredCameraPosition,
      this.currentPositionSpeed
    );
    this.currentCameraPosition.copy(this.camera.position);

    // Smoothly interpolate camera rotation
    this.camera.quaternion.slerp(
      this.desiredCameraRotation,
      this.currentRotationSpeed
    );
    this.currentCameraRotation.copy(this.camera.quaternion);

    this.renderer.render(this.scene, this.camera);
  }

  focusOnPainting(id) {
    if (!this.isReady) {
      debug.warn(
        "Room3D: Cannot focus on painting before initialization is complete"
      );
      return;
    }
    const painting = this.paintingManager.getPaintingById(id);
    if (!painting) {
      debug.warn("Room3D: No painting found with id:", id);
      return;
    }

    debug.log('Focusing on painting:', {
      id,
      position: painting.mesh.position,
      rotation: painting.mesh.rotation,
      userData: painting.mesh.userData
    });

    this.currentFocus = painting.id;

    // Set to faster animation speeds for focusing
    this.currentPositionSpeed = this.focusPositionSpeed;
    this.currentRotationSpeed = this.focusRotationSpeed;

    // Get optimal camera position from PaintingManager
    const cameraSetup = this.paintingManager.calculateOptimalCameraPositionForPainting(painting, this.camera);
    if (!cameraSetup) {
      debug.error("Room3D: Failed to calculate camera position for painting:", id);
      return;
    }

    debug.log('Camera setup received:', cameraSetup);

    // Set desired camera position
    this.desiredCameraPosition.copy(cameraSetup.position);

    // Calculate and set desired rotation
    const m = new THREE.Matrix4().lookAt(
      this.desiredCameraPosition,
      cameraSetup.target,
      new THREE.Vector3(0, 1, 0)
    );
    this.desiredCameraRotation.setFromRotationMatrix(m);

    debug.log('Camera transition setup:', {
      currentPosition: this.camera.position.clone(),
      desiredPosition: this.desiredCameraPosition.clone(),
      currentRotation: this.camera.quaternion.clone(),
      desiredRotation: this.desiredCameraRotation.clone()
    });
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
      this.roomDimensions.depth / 2 + optimalPosition.distance
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
    debug.log("Ratios:", {
      viewport: viewportRatio,
      room: roomRatio,
      fittingToHeight: roomRatio > viewportRatio,
    });
    debug.log("Calculated distance:", distance);

    return {
      distance: distance,
      height: 0,
    };
  }

  handleResize() {
    // Update renderer size
    this.renderer.setSize(
      this.container.offsetWidth,
      this.container.offsetHeight
    );

    // Reset FOV to default
    this.camera.fov = 75;

    // Update camera aspect ratio
    this.camera.aspect =
      this.container.offsetWidth / this.container.offsetHeight;

    // Recalculate optimal camera position
    const optimalPosition = this.calculateOptimalCameraPosition();

    // If we're at the default view (not focused on a painting), update desired position
    const distanceToOrigin = new THREE.Vector3(0, 0, 0).distanceTo(
      this.desiredCameraPosition
    );
    const defaultDistance =
      this.roomDimensions.depth / 2 + optimalPosition.distance;
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

  // Add new method for click handling
  handleClick(event) {
    if (!this.onPaintingClick) return;

    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Get all painting meshes and their additional images
    const allMeshes = [];
    this.paintingManager.paintings.forEach(p => {
      allMeshes.push(p.mesh);
      if (p.mesh.userData.additionalImageMeshes) {
        p.mesh.userData.additionalImageMeshes.forEach((imgMesh, index) => {
          // Store the parent painting id and image index in the mesh's userData
          imgMesh.userData = {
            parentPaintingId: p.id,
            imageIndex: index + 1 // +1 because main image will be at index 0
          };
          allMeshes.push(imgMesh);
        });
      }
    });

    // Calculate objects intersecting the picking ray
    const intersects = this.raycaster.intersectObjects(allMeshes);

    if (intersects.length > 0) {
      // Get the first intersected mesh
      const clickedMesh = intersects[0].object;
      
      if (clickedMesh.userData.parentPaintingId !== undefined) {
        // This is an additional image
        const parentPaintingId = clickedMesh.userData.parentPaintingId;
        const imageIndex = clickedMesh.userData.imageIndex;
        
        // Call the click handler with both IDs
        this.onPaintingClick(parentPaintingId, imageIndex);
      } else {
        // This is a main painting
        this.onPaintingClick(clickedMesh.userData.id);
      }
    }
  }

  // Add method to set click handler
  setOnPaintingClick(handler) {
    this.onPaintingClick = handler;
  }

  destroy() {
    // Remove event listeners when cleaning up
    window.removeEventListener("resize", this.handleResize);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
  }
}
