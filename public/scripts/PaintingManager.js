import * as THREE from 'https://unpkg.com/three@0.176.0/build/three.module.js';
import { debug } from './debug.js';
import SubContentManager from './SubContentManager.js';

export default class PaintingManager {
  constructor(scene, roomDimensions, maxPaintingSize) {
    this.scene = scene;
    this.roomDimensions = roomDimensions;
    this.maxPaintingSize = maxPaintingSize;
    this.paintings = [];
    this.usedPositions = [];
    this.textureLoader = new THREE.TextureLoader();
    this.PADDING = 0.1;  // 10cm padding between elements
    this.PAINTING_PADDING = 0.05; // 5cm padding between painting and additional images
    this.MAX_SIZE = 0.8; // 80cm maximum size for additional images
    this.MIN_SIZE = 0.3; // 30cm minimum size for additional images
    
    // Initialize SubContentManager
    this.subContentManager = new SubContentManager(scene);
  }

  loadPainting(paintingData, id) {
    return new Promise((resolve) => {
      this.textureLoader.load(paintingData.url, (texture) => {
        // Calculate aspect ratio and dimensions
        const aspectRatio = texture.image.width / texture.image.height;
        let width, height;
        
        if (aspectRatio > 1) {
          // Landscape orientation
          width = 4; // Base size for main paintings
          height = width / aspectRatio;
        } else {
          // Portrait orientation
          height = 4; // Base size for main paintings
          width = height * aspectRatio;
        }

        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({ 
          map: texture,
          side: THREE.DoubleSide 
        });
        const mesh = new THREE.Mesh(geometry, material);

        mesh.userData = { 
          id,
          title: paintingData.title || `Painting ${id}`,
          description: paintingData.description || '',
          hasAdditionalImages: paintingData.images && Array.isArray(paintingData.images) && paintingData.images.length > 0,
          additionalImagesCount: paintingData.images ? paintingData.images.length : 0,
          isPortrait: aspectRatio <= 1,
          additionalImageMeshes: [],
          hasSubContent: paintingData.sub && Array.isArray(paintingData.sub) && paintingData.sub.length > 0,
          subContent: paintingData.sub || []
        };

        const painting = { id, mesh };
        this.paintings.push(painting);

        // If there are additional images, load them but don't position them yet
        if (paintingData.images && Array.isArray(paintingData.images) && paintingData.images.length > 0) {
          const additionalImagesPromises = paintingData.images.map(imgUrl => 
            new Promise((resolveImage) => {
              this.textureLoader.load(imgUrl, (imgTexture) => {
                const imgAspectRatio = imgTexture.image.width / imgTexture.image.height;
                const imgWidth = this.MAX_SIZE;
                const imgHeight = imgWidth / imgAspectRatio;
                
                const smallGeometry = new THREE.PlaneGeometry(imgWidth, imgHeight);
                const smallMaterial = new THREE.MeshBasicMaterial({
                  map: imgTexture,
                  side: THREE.DoubleSide
                });
                const smallMesh = new THREE.Mesh(smallGeometry, smallMaterial);
                mesh.userData.additionalImageMeshes.push(smallMesh);
                resolveImage();
              });
            })
          );

          Promise.all(additionalImagesPromises).then(() => resolve(painting));
        } else {
          resolve(painting);
        }
      });
    });
  }

  calculatePaintingCompositionSize(paintingMesh) {
    if (!paintingMesh) return { width: 0, height: 0 };

    const geometry = paintingMesh.geometry;
    const paintingWidth = geometry.parameters.width;
    const paintingHeight = geometry.parameters.height;
    
    let totalWidth = paintingWidth;
    let totalHeight = paintingHeight;

    if (paintingMesh.userData.hasAdditionalImages) {
      if (paintingMesh.userData.isPortrait) {
        // For portrait, calculate additional width from columns
        const columnWidth = this.MAX_SIZE + this.PADDING;
        const estimatedColumns = Math.ceil(paintingMesh.userData.additionalImagesCount / 3); // Assume ~3 images per column
        totalWidth += (columnWidth * estimatedColumns) + this.PADDING;
      } else {
        // For landscape, calculate additional height from rows
        const avgImagesPerRow = Math.floor((paintingWidth * 0.8) / (this.MAX_SIZE + this.PADDING));
        const estimatedRows = Math.ceil(paintingMesh.userData.additionalImagesCount / avgImagesPerRow);
        totalHeight += (estimatedRows * this.MAX_SIZE) + ((estimatedRows + 1) * this.PADDING);
      }
    }

    return { width: totalWidth, height: totalHeight };
  }

  calculateOptimalCameraPositionForPainting(painting, camera) {
    if (!painting || !painting.mesh) {
      debug.error('Invalid painting object provided to calculateOptimalCameraPositionForPainting');
      return null;
    }

    const paintingPos = painting.mesh.position.clone();
    const geometry = painting.mesh.geometry;
    const paintingWidth = geometry.parameters.width;
    const paintingHeight = geometry.parameters.height;
    const compositionSize = this.calculatePaintingCompositionSize(painting.mesh);

    debug.log('Painting dimensions:', {
      width: paintingWidth,
      height: paintingHeight,
      totalWidth: compositionSize.width,
      totalHeight: compositionSize.height,
      position: paintingPos,
      isPortrait: painting.mesh.userData.isPortrait,
      hasAdditionalImages: painting.mesh.userData.hasAdditionalImages
    });

    // Calculate optimal distance based only on main painting dimensions
    const fov = camera.fov * (Math.PI / 180);
    const maxPaintingDimension = Math.max(paintingWidth, paintingHeight);
    const padding = 1.2; // Add 20% padding around the composition
    const optimalDistance = (maxPaintingDimension * padding) / (2 * Math.tan(fov / 2));

    // Start with the center position of the main painting
    let compositionCenter = paintingPos.clone();
    
    // Calculate shifts for additional images if they exist
    if (painting.mesh.userData.hasAdditionalImages) {
      if (painting.mesh.userData.isPortrait) {
        // Calculate viewport width at the camera distance
        const viewportWidthAtDistance = 2 * optimalDistance * Math.tan((camera.fov * Math.PI / 180) / 2 * camera.aspect);
        
        // Calculate the space needed for the main painting plus padding
        const mainPaintingSpace = paintingWidth + (viewportWidthAtDistance * 0.2); // 20% of viewport for padding
        
        // Calculate maximum possible shift while keeping main painting visible
        const maxPossibleShift = (viewportWidthAtDistance - mainPaintingSpace) / 2;

        // Calculate the ideal shift based on composition size
        const compositionSize = this.calculatePaintingCompositionSize(painting.mesh);
        const idealShift = (compositionSize.width - paintingWidth) / 4;
        
        // Cap the shift to the maximum possible value
        const shift = Math.min(idealShift, maxPossibleShift);

        // Apply the shift based on wall orientation
        switch (painting.mesh.rotation.y) {
          case Math.PI / 2: // Left wall
            compositionCenter.z += shift;
            break;
          case -Math.PI / 2: // Right wall
            compositionCenter.z -= shift;
            break;
          case 0: // Front wall
            compositionCenter.x -= shift;
            break;
        }
      } else {
        // For landscape, calculate viewport height at the camera distance
        const viewportHeightAtDistance = 2 * optimalDistance * Math.tan(fov / 2);
        
        // Calculate the space needed for the main painting plus padding
        const mainPaintingSpace = paintingHeight + (viewportHeightAtDistance * 0.2); // 20% of viewport for padding
        
        // Calculate maximum possible shift while keeping main painting visible
        const maxPossibleShift = (viewportHeightAtDistance - mainPaintingSpace) / 2;

        // Calculate the ideal shift based on composition size
        const compositionSize = this.calculatePaintingCompositionSize(painting.mesh);
        const idealShift = (compositionSize.height - paintingHeight) / 2;
        
        // Cap the shift to the maximum possible value
        const shift = Math.min(idealShift, maxPossibleShift);
        
        // Apply the shift downward
        compositionCenter.y -= shift;
      }
    }

    // Calculate offset based on painting rotation
    const offset = new THREE.Vector3();
    switch (painting.mesh.rotation.y) {
      case Math.PI / 2: // Left wall
        offset.set(optimalDistance, 0, 0);
        break;
      case -Math.PI / 2: // Right wall
        offset.set(-optimalDistance, 0, 0);
        break;
      case 0: // Front wall
        offset.set(0, 0, optimalDistance);
        break;
      default:
        debug.warn('Unknown painting rotation:', painting.mesh.rotation.y);
        break;
    }

    // Calculate final camera position based on composition center
    const cameraPosition = compositionCenter.clone().add(offset);
    
    return {
      position: cameraPosition,
      target: compositionCenter
    };
  }

  async positionPainting(painting, position, rotation) {
    const meshP = painting.mesh;
    
    // Position additional images if they exist
    if (meshP.userData.hasAdditionalImages) {
      this.positionAdditionalImages(painting, position.clone(), rotation);
    }

    // If it's a portrait painting with additional images, shift it left
    if (meshP.userData.hasAdditionalImages && meshP.userData.isPortrait) {
      const shift = -0.75;
      switch (rotation) {
        case Math.PI / 2: // Left wall
          position.z -= shift;
          break;
        case -Math.PI / 2: // Right wall
          position.z += shift;
          break;
        case 0: // Front wall
          position.x += shift;
          break;
      }
    }

    meshP.position.copy(position);
    meshP.rotation.y = rotation;
    this.scene.add(meshP);

    // Add sub-content if it exists
    if (meshP.userData.hasSubContent) {
      await this.subContentManager.createSubContent(
        painting.id,
        meshP.userData.subContent,
        position.clone(),
        rotation
      );
    }
  }

  positionAdditionalImages(painting, position, rotation) {
    const mesh = painting.mesh;
    const geometry = mesh.geometry;
    const paintingWidth = geometry.parameters.width;
    const paintingHeight = geometry.parameters.height;
    const additionalMeshes = mesh.userData.additionalImageMeshes;

    if (mesh.userData.isPortrait) {
      // Position in columns to the left
      let currentColumn = [];
      let columnIndex = 0;
      let currentHeight = 0;

      for (let i = 0; i < additionalMeshes.length; i++) {
        const imgMesh = additionalMeshes[i];
        const estimatedHeight = this.MAX_SIZE / (imgMesh.geometry.parameters.width / imgMesh.geometry.parameters.height);

        if (currentHeight + estimatedHeight + (currentColumn.length * this.PADDING) > paintingHeight && currentColumn.length > 0) {
          this.layoutColumn(currentColumn, position, rotation, columnIndex, paintingHeight);
          columnIndex++;
          currentColumn = [];
          currentHeight = 0;
        }

        currentColumn.push(imgMesh);
        currentHeight += estimatedHeight;

        if (i === additionalMeshes.length - 1 && currentColumn.length > 0) {
          this.layoutColumn(currentColumn, position, rotation, columnIndex, paintingHeight);
        }
      }
    } else {
      // Position in rows below
      this.layoutRows(additionalMeshes, position, rotation, paintingWidth, paintingHeight);
    }
  }

  layoutColumn(images, paintingPosition, rotation, columnIndex, paintingHeight) {
    // Calculate scale based on height constraint and maximum size
    const totalAspectRatio = images.reduce((sum, img) => 
      sum + img.geometry.parameters.height / img.geometry.parameters.width, 0
    );
    const totalPadding = (images.length - 1) * this.PADDING;
    const scale = Math.min(
      this.MAX_SIZE / Math.max(...images.map(img => img.geometry.parameters.width)),
      (paintingHeight - totalPadding) / (totalAspectRatio * this.MAX_SIZE)
    );
    const finalScale = Math.max(
      this.MIN_SIZE / Math.max(...images.map(img => img.geometry.parameters.width)), 
      scale
    );

    let yPosition = paintingPosition.y + (paintingHeight/2); // Start from top
    const columnWidth = this.MAX_SIZE + this.PADDING * 0.2; // Minimal padding between columns
    const columnOffset = columnWidth * columnIndex;

    // Calculate base positions based on wall orientation
    let baseX = paintingPosition.x;
    let baseZ = paintingPosition.z;

    // Use the same small padding as vertical gaps (this.PADDING)
    const initialPadding = this.PADDING; // Match the vertical gap size

    switch (rotation) {
      case Math.PI / 2: // Left wall
        baseZ = paintingPosition.z + paintingHeight/2 + initialPadding + columnOffset;
        break;
      case -Math.PI / 2: // Right wall
        baseZ = paintingPosition.z - paintingHeight/2 - initialPadding - columnOffset;
        break;
      case 0: // Front wall
        baseX = paintingPosition.x - paintingHeight/2 - initialPadding - columnOffset;
        break;
    }

    images.forEach((imgMesh) => {
      const scaledWidth = imgMesh.geometry.parameters.width * finalScale;
      const scaledHeight = imgMesh.geometry.parameters.height * finalScale;
      
      imgMesh.position.set(
        baseX,
        yPosition - scaledHeight/2,
        baseZ
      );
      imgMesh.scale.set(finalScale, finalScale, 1);
      imgMesh.rotation.y = rotation;
      this.scene.add(imgMesh);
      
      yPosition -= scaledHeight + this.PADDING;
    });
  }

  layoutRows(images, paintingPosition, rotation, paintingWidth, paintingHeight) {
    // Start position is directly below the painting
    const startY = paintingPosition.y - (paintingHeight/2) - this.PADDING;
    
    // Determine optimal images per row based on painting width
    const maxImagesPerRow = Math.min(4, Math.max(2, Math.floor(paintingWidth / (this.MIN_SIZE + this.PADDING))));

    // Group images into rows
    const rows = [];
    for (let i = 0; i < images.length; i += maxImagesPerRow) {
      rows.push(images.slice(i, Math.min(i + maxImagesPerRow, images.length)));
    }

    // Layout each row
    let currentY = startY;
    rows.forEach(rowImages => {
      // Get aspect ratios for all images in the row
      const aspectRatios = rowImages.map(img => 
        img.geometry.parameters.width / img.geometry.parameters.height
      );

      // Calculate row height that will make images fill the painting width
      const totalPadding = (rowImages.length - 1) * this.PADDING;
      const availableWidth = paintingWidth;
      
      // Sum of aspect ratios determines relative widths
      const aspectRatioSum = aspectRatios.reduce((sum, ratio) => sum + ratio, 0);
      
      // Calculate height that will make the row exactly fill the width
      let rowHeight = (availableWidth - totalPadding) / aspectRatioSum;
      
      // Constrain height between MIN_SIZE and MAX_SIZE
      rowHeight = Math.min(this.MAX_SIZE, Math.max(this.MIN_SIZE, rowHeight));

      // Calculate widths based on the final height
      const widths = aspectRatios.map(ratio => rowHeight * ratio);

      // Position images in row - start from left edge
      let currentX = -paintingWidth/2; // Start from the absolute left edge

      rowImages.forEach((img, index) => {
        const width = widths[index];
        
        // Calculate position based on wall orientation
        let finalX = paintingPosition.x;
        let finalZ = paintingPosition.z;

        switch (rotation) {
          case Math.PI / 2: // Left wall
            finalZ = paintingPosition.z + currentX + width/2;
            break;
          case -Math.PI / 2: // Right wall
            finalZ = paintingPosition.z - currentX - width/2;
            break;
          case 0: // Front wall
            finalX = paintingPosition.x + currentX + width/2;
            break;
        }

        // Position and scale the image
        img.position.set(finalX, currentY - rowHeight/2, finalZ);
        const scale = width / img.geometry.parameters.width; // Calculate uniform scale
        img.scale.set(scale, scale, 1); // Use uniform scale to maintain proportions
        img.rotation.y = rotation;
        this.scene.add(img);

        // Move to next position
        currentX += width + this.PADDING;
      });

      // Move down for next row
      currentY -= rowHeight + this.PADDING;
    });
  }

  getPaintingById(id) {
    const painting = this.paintings.find(p => p.id === id);
    if (!painting) {
      debug.warn(`No painting found with id: ${id}`);
    }
    return painting;
  }
} 