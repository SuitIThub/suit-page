import * as THREE from "https://unpkg.com/three@0.176.0/build/three.module.js";

export default class SubContentManager {
  constructor(scene) {
    this.scene = scene;
    this.textureLoader = new THREE.TextureLoader();
    this.subContentMeshes = new Map(); // Map<paintingId, Array<Mesh>>
    
    // Constants for layout
    this.BLOCK_PADDING = 0.1; // 10cm padding between blocks
    this.BLOCK_WIDTH = 2.0; // 2m width for blocks
    this.TITLE_HEIGHT = 0.3; // 30cm height for title
    this.TEXT_LINE_HEIGHT = 0.15; // 15cm height per text line
    this.IMAGE_HEIGHT = 1.5; // 1.5m height for images
    this.LINK_HEIGHT = 0.3; // 30cm height for links
    this.SIDE_OFFSET = 0.5; // 50cm offset from painting edge
  }

  async createSubContent(paintingId, subData, position, rotation) {
    if (!subData || !Array.isArray(subData)) return;

    const meshes = [];
    let currentY = position.y + this.BLOCK_WIDTH/2; // Start from top

    // Get the painting mesh to calculate proper offset
    const painting = this.scene.children.find(child => 
      child.userData && child.userData.id === paintingId
    );

    if (!painting) return;

    // Calculate the painting's width
    const paintingWidth = painting.geometry.parameters.width;

    // Calculate base position to the right of the painting
    let baseX = position.x;
    let baseZ = position.z;
    
    switch (rotation) {
      case Math.PI / 2: // Left wall
        baseZ = position.z + paintingWidth/2 + this.SIDE_OFFSET;
        break;
      case -Math.PI / 2: // Right wall
        baseZ = position.z - paintingWidth/2 - this.SIDE_OFFSET;
        break;
      case 0: // Front wall
        baseX = position.x + paintingWidth/2 + this.SIDE_OFFSET;
        break;
    }

    for (const block of subData) {
      let mesh;
      switch (block.type) {
        case 'title':
          mesh = await this.createTitleBlock(block, baseX, currentY, baseZ, rotation);
          currentY -= this.TITLE_HEIGHT + this.BLOCK_PADDING;
          break;
        case 'text':
          mesh = await this.createTextBlock(block, baseX, currentY, baseZ, rotation);
          currentY -= (this.calculateTextHeight(block.text) + this.BLOCK_PADDING);
          break;
        case 'image':
          mesh = await this.createImageBlock(block, baseX, currentY, baseZ, rotation);
          currentY -= (this.IMAGE_HEIGHT + this.BLOCK_PADDING);
          break;
        case 'link':
          mesh = await this.createLinkBlock(block, baseX, currentY, baseZ, rotation);
          currentY -= (this.LINK_HEIGHT + this.BLOCK_PADDING);
          break;
      }
      if (mesh) {
        this.scene.add(mesh);
        meshes.push(mesh);
      }
    }

    this.subContentMeshes.set(paintingId, meshes);
  }

  createTitleBlock(block, x, y, z, rotation) {
    const geometry = new THREE.PlaneGeometry(this.BLOCK_WIDTH, this.TITLE_HEIGHT);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;

    // Style the text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(block.text, 10, canvas.height/2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.positionBlock(mesh, x, y, z, rotation);
    return mesh;
  }

  createTextBlock(block, x, y, z, rotation) {
    const height = this.calculateTextHeight(block.text);
    const geometry = new THREE.PlaneGeometry(this.BLOCK_WIDTH, height);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = Math.ceil(height * 256);

    // Style the text
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'left';
    
    // Word wrap the text
    const words = block.text.split(' ');
    let line = '';
    let lineY = 40;
    const maxWidth = canvas.width - 20;

    for (let word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth) {
        ctx.fillText(line, 10, lineY);
        line = word + ' ';
        lineY += 36;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 10, lineY);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.positionBlock(mesh, x, y, z, rotation);
    return mesh;
  }

  async createImageBlock(block, x, y, z, rotation) {
    return new Promise((resolve) => {
      this.textureLoader.load(block.image, (texture) => {
        const aspectRatio = texture.image.width / texture.image.height;
        const width = Math.min(this.BLOCK_WIDTH, this.IMAGE_HEIGHT * aspectRatio);
        const height = width / aspectRatio;

        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({ 
          map: texture,
          side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        this.positionBlock(mesh, x, y, z, rotation);
        resolve(mesh);
      });
    });
  }

  createLinkBlock(block, x, y, z, rotation) {
    const geometry = new THREE.PlaneGeometry(this.BLOCK_WIDTH, this.LINK_HEIGHT);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 64;

    // Style the link
    ctx.fillStyle = '#0077ff';
    ctx.font = '32px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(block.text, 10, canvas.height/2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ 
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = {
      type: 'link',
      url: block.url
    };
    
    this.positionBlock(mesh, x, y, z, rotation);
    return mesh;
  }

  positionBlock(mesh, x, y, z, rotation) {
    // Adjust position to account for mesh width for proper left alignment
    const width = mesh.geometry.parameters.width;
    let adjustedX = x;
    let adjustedZ = z;

    switch (rotation) {
      case Math.PI / 2: // Left wall
        adjustedZ = z;
        break;
      case -Math.PI / 2: // Right wall
        adjustedZ = z;
        break;
      case 0: // Front wall
        adjustedX = x;
        break;
    }

    mesh.position.set(adjustedX, y, adjustedZ);
    mesh.rotation.y = rotation;
  }

  calculateTextHeight(text) {
    const CHARS_PER_LINE = 40;
    const lines = Math.ceil(text.length / CHARS_PER_LINE);
    return lines * this.TEXT_LINE_HEIGHT;
  }

  removeSubContent(paintingId) {
    const meshes = this.subContentMeshes.get(paintingId);
    if (meshes) {
      meshes.forEach(mesh => {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material.map) {
          mesh.material.map.dispose();
        }
        mesh.material.dispose();
      });
      this.subContentMeshes.delete(paintingId);
    }
  }
} 