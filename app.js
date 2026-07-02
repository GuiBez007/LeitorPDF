// HQ Reader App


// Configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = {
    currentScreen: 'library',
    currentSubject: null,
    currentPDF: null,
    pdfDoc: null,
    pageNum: 1,
    pageIsRendering: false,
    pageNumIsPending: null,
    viewMode: 'single', // 'single' or 'double'
    sidebarPosition: localStorage.getItem('hq_reader_sidebar_position') || 'side',
    library: JSON.parse(localStorage.getItem('hq_reader_library')) || [],
    userData: JSON.parse(localStorage.getItem('hq_reader_user_data')) || {

        seen: [],
        favorites: []
    }
};


function saveLibrary() {
    localStorage.setItem('hq_reader_library', JSON.stringify(state.library));
}


function saveUserData() {
    localStorage.setItem('hq_reader_user_data', JSON.stringify(state.userData));
}


// DOM Elements
const libraryScreen = document.getElementById('library-screen');
const galleryScreen = document.getElementById('gallery-screen');
const subjectsGrid = document.getElementById('subjects-grid');
const galleryTitle = document.getElementById('gallery-title'); // Legacy, but kept for safety

const readerOverlay = document.getElementById('reader-overlay');
const readerTitle = document.getElementById('reader-title');
const pageInfo = document.getElementById('page-info');
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const canvas2 = document.getElementById('pdf-canvas-2');
const ctx2 = canvas2.getContext('2d');
const loadingSpinner = document.getElementById('pdf-loading');
const canvasContainer = document.getElementById('canvas-container');
const pageWrapper = document.getElementById('page-wrapper');
const pageShine = document.querySelector('.page-shine');
const chapterList = document.getElementById('chapter-list');
const btnImportFolder = document.getElementById('btn-import-folder');
const viewModeCard = document.getElementById('view-mode-card');
const viewModeText = document.getElementById('view-mode-text');
const viewModeIcon = document.getElementById('view-mode-icon');
const sidebarPositionCard = document.getElementById('sidebar-position-card');
const sidebarPositionText = document.getElementById('sidebar-position-text');
const sidebarPositionIcon = document.getElementById('sidebar-position-icon');
const readerCard = document.getElementById('reader-card');








const btnPrev = document.getElementById('prev-page');
const btnNext = document.getElementById('next-page');
const btnClose = document.getElementById('close-reader');

// Folder existence verification on load
async function checkFolderExists(item) {
    if (!item.files || item.files.length === 0) return false;

    try {
        // Tenta buscar o primeiro arquivo da pasta
        const firstFileUrl = `PDFs/${item.folder}/${item.files[0]}`;
        const response = await fetch(firstFileUrl, { method: 'HEAD' });

        // Se retornar 404, verifica mais alguns arquivos para garantir que não é apenas o primeiro arquivo que sumiu
        if (response.status === 404) {
            for (let i = 1; i < Math.min(item.files.length, 3); i++) {
                const checkUrl = `PDFs/${item.folder}/${item.files[i]}`;
                const resp = await fetch(checkUrl, { method: 'HEAD' });
                if (resp.status !== 404) {
                    return true; // Pelo menos um arquivo existe, então a pasta existe
                }
            }
            return false; // Todos os arquivos testados retornaram 404 (pasta excluída ou renomeada)
        }

        // Se retornar qualquer outro status (200, 304, 403, etc.), assumimos que a pasta existe
        return true;
    } catch (error) {
        // Em caso de erro de rede ou servidor fora do ar, assume que a pasta existe 
        // para evitar limpar a biblioteca do usuário por engano
        console.warn(`Não foi possível verificar a pasta ${item.folder}:`, error);
        return true;
    }
}

async function verifyLibraryFolders() {
    if (state.library.length === 0) return;

    try {
        const checks = await Promise.all(
            state.library.map(async (item) => {
                const exists = await checkFolderExists(item);
                item.exists = exists; // Define o flag em memória
                return { item, exists };
            })
        );

        let hiddenCount = 0;
        for (const result of checks) {
            if (!result.exists) {
                hiddenCount++;
            }
        }

        if (hiddenCount > 0) {
            alert(`${hiddenCount} pastas foram ocultadas por não serem localizadas.`);
        }
    } catch (error) {
        console.error('Erro ao verificar as pastas da biblioteca:', error);
    }
}

// Initialize
async function init() {
    await verifyLibraryFolders();
    sortLibrary();
    renderSubjects();
    setupEventListeners();
    updateSidebarPositionUI();
}

function sortLibrary() {
    state.library.forEach(lib => {
        lib.files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    });
}


// Render Screen 1: Subjects
function renderSubjects() {
    subjectsGrid.innerHTML = '';

    // Filtra para exibir apenas os assuntos/pastas que foram localizados localmente
    const visibleSubjects = state.library.filter(item => item.exists !== false);

    const totalElement = document.getElementById('total-subjects');
    if (totalElement) {
        totalElement.textContent = `total ${visibleSubjects.length}`;
    }

    visibleSubjects.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.position = 'relative'; // Ensure button positioning
        card.innerHTML = `
            <button class="card-remove" title="Remover Assunto">✕</button>
            <div class="icon">📁</div>
            <h3>${item.subject}</h3>
            <p>${item.files.length} PDFs</p>
        `;
        card.onclick = (e) => {
            if (e.target.classList.contains('card-remove')) {
                removeSubject(item.subject);
                return;
            }
            openSubject(item);
        };

        subjectsGrid.appendChild(card);
    });
}

function removeSubject(subjectName) {
    if (!confirm(`Deseja remover "${subjectName}" da biblioteca?`)) return;
    state.library = state.library.filter(item => item.subject !== subjectName);
    saveLibrary();
    renderSubjects();
}



// Screen 2: Skip Gallery, open first PDF
function openSubject(subject) {
    state.currentSubject = subject;
    state.currentScreen = 'reader';

    // Open the first file in the subject
    if (subject.files.length > 0) {
        openReader(subject, subject.files[0]);
    }
}

function showLibrary() {
    state.currentScreen = 'library';
    state.currentSubject = null;

    libraryScreen.classList.remove('hidden');
}


// PDF Reader Logic
async function openReader(subject, fileName) {
    state.currentSubject = subject;
    state.currentPDF = fileName;
    state.pageNum = 1;
    readerTitle.textContent = fileName;
    readerOverlay.classList.remove('hidden');
    loadingSpinner.classList.remove('hidden');

    renderChapterList();
    updateSidebarPositionUI();

    const url = `PDFs/${subject.folder}/${fileName}`;


    try {
        const loadingTask = pdfjsLib.getDocument(url);
        state.pdfDoc = await loadingTask.promise;
        renderPage(state.pageNum);
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Erro ao carregar o PDF. Verifique se o servidor local está rodando.');
        closeReader();
    }
}

function renderChapterList() {
    if (!state.currentSubject) return;

    chapterList.innerHTML = '';
    state.currentSubject.files.forEach(file => {
        const isSeen = state.userData.seen.includes(file);
        const isFav = state.userData.favorites.includes(file);

        const item = document.createElement('div');
        item.className = `chapter-item ${file === state.currentPDF ? 'active' : ''}`;

        item.innerHTML = `
            <div class="chapter-name">${file}</div>
            <div class="chapter-meta">
                <span class="badge ${isSeen ? 'badge-seen' : 'badge-unseen'}">${isSeen ? 'Visto' : 'Novo'}</span>
                <span class="star ${isFav ? 'active' : ''}" data-file="${file}">★</span>
            </div>
        `;

        // Click to open
        item.onclick = (e) => {
            if (e.target.classList.contains('star')) {
                toggleFavorite(file);
                e.stopPropagation();
                return;
            }
            if (e.target.classList.contains('badge')) {
                toggleSeen(file);
                e.stopPropagation();
                return;
            }
            if (file !== state.currentPDF) openReader(state.currentSubject, file);
        };


        chapterList.appendChild(item);
    });
}

function toggleFavorite(file) {
    const index = state.userData.favorites.indexOf(file);
    if (index > -1) {
        state.userData.favorites.splice(index, 1);
    } else {
        state.userData.favorites.push(file);
    }
    saveUserData();
    renderChapterList();
}

function toggleSeen(file) {
    const index = state.userData.seen.indexOf(file);
    if (index > -1) {
        state.userData.seen.splice(index, 1);
    } else {
        state.userData.seen.push(file);
    }
    saveUserData();
    renderChapterList();
}

function nextFile() {
    if (!state.currentSubject || !state.currentPDF) return;
    const files = state.currentSubject.files;
    const currentIndex = files.indexOf(state.currentPDF);
    if (currentIndex < files.length - 1) {
        openReader(state.currentSubject, files[currentIndex + 1]);
    }
}

function prevFile() {
    if (!state.currentSubject || !state.currentPDF) return;
    const files = state.currentSubject.files;
    const currentIndex = files.indexOf(state.currentPDF);
    if (currentIndex > 0) {
        openReader(state.currentSubject, files[currentIndex - 1]);
    }
}





async function renderPage(num, direction = null) {
    if (state.pageIsRendering) {
        state.pageNumIsPending = num;
        return;
    }

    state.pageIsRendering = true;

    // Play exit animation if direction is provided
    if (direction) {
        if (state.viewMode === 'double') {
            pageWrapper.className = `view-double book-flip-${direction}`;
        } else {
            pageWrapper.className = `page-flip-${direction}`;
        }
        pageShine.className = 'page-shine page-shine-anim';
        await new Promise(resolve => setTimeout(resolve, 400)); // Wait for half animation
    }




    try {

        const isDouble = state.viewMode === 'double';

        // Use Offscreen Canvases to prevent flickering during render
        const renderOnCanvas = async (pageNum, targetCanvas, targetCtx) => {
            const page = await state.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1 });

            const margin = state.sidebarPosition === 'top' ? 16 : 80;
            let containerWidth = canvasContainer.clientWidth - margin;
            let containerHeight = canvasContainer.clientHeight - margin;
            if (isDouble) containerWidth /= 2;

            const scale = Math.min(containerWidth / viewport.width, containerHeight / viewport.height);
            const scaledViewport = page.getViewport({ scale: scale * 1.5 });

            // Create a temporary offscreen canvas
            const offscreen = document.createElement('canvas');
            offscreen.width = scaledViewport.width;
            offscreen.height = scaledViewport.height;
            const offscreenCtx = offscreen.getContext('2d');

            await page.render({ canvasContext: offscreenCtx, viewport: scaledViewport }).promise;

            // Atomic update: resize and draw in one go
            targetCanvas.width = offscreen.width;
            targetCanvas.height = offscreen.height;

            // Set style dimensions to display at the correct physical size
            targetCanvas.style.width = `${viewport.width * scale}px`;
            targetCanvas.style.height = `${viewport.height * scale}px`;

            targetCtx.drawImage(offscreen, 0, 0);
        };

        // Render Page 1
        await renderOnCanvas(num, canvas, ctx);

        // Render Page 2 if double mode
        if (isDouble && num + 1 <= state.pdfDoc.numPages) {
            canvas2.classList.remove('hidden');
            await renderOnCanvas(num + 1, canvas2, ctx2);
        } else {
            canvas2.classList.add('hidden');
        }

        // Play enter animation
        if (direction) {

            if (state.viewMode === 'double') {
                pageWrapper.className = `view-double book-enter-${direction}`;
            } else {
                pageWrapper.className = `page-enter-3d-${direction}`;
            }
        } else {
            pageWrapper.className = `view-${state.viewMode}`;
        }

        pageShine.className = 'page-shine';

    } catch (err) {
        console.error('Render error:', err);
    } finally {
        state.pageIsRendering = false;
        loadingSpinner.classList.add('hidden'); // Fix infinite spinner

        if (state.pageNumIsPending !== null) {


            const nextNum = state.pageNumIsPending;
            state.pageNumIsPending = null;
            renderPage(nextNum, direction);
        }

        // Update UI
        const fileIndex = state.currentSubject.files.indexOf(state.currentPDF) + 1;
        const totalFiles = state.currentSubject.files.length;

        let pageDisplay = num;
        if (state.viewMode === 'double' && num + 1 <= state.pdfDoc.numPages) {
            pageDisplay = `${num}-${num + 1}`;
        }

        // Formatted as: Arquivo [1/20]               Página [1/11]
        pageInfo.textContent = `Arquivo ${fileIndex}/${totalFiles} \u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0 Página ${pageDisplay}/${state.pdfDoc.numPages}`;
        btnPrev.disabled = num <= 1;

        btnNext.disabled = num >= state.pdfDoc.numPages;
    }
}


function queueRenderPage(num, direction = null) {
    if (state.pageIsRendering) {
        state.pageNumIsPending = num;
    } else {
        renderPage(num, direction);
    }
}

function prevPage() {
    if (state.pageNum <= 1 || state.pageIsRendering) return;
    const step = state.viewMode === 'double' ? 2 : 1;
    state.pageNum = Math.max(1, state.pageNum - step);
    queueRenderPage(state.pageNum, 'prev');
}

function nextPage() {
    if (state.pageNum >= state.pdfDoc.numPages || state.pageIsRendering) return;
    const step = state.viewMode === 'double' ? 2 : 1;
    if (state.pageNum + step > state.pdfDoc.numPages) return;
    state.pageNum += step;
    queueRenderPage(state.pageNum, 'next');
}



function updateSidebarPositionUI() {
    const position = state.sidebarPosition || 'side';
    if (position === 'side') {
        if (readerCard) readerCard.classList.remove('layout-top');
        if (sidebarPositionText) sidebarPositionText.textContent = 'Menu Lateral';
        if (sidebarPositionIcon) sidebarPositionIcon.textContent = '↔️';
    } else {
        if (readerCard) readerCard.classList.add('layout-top');
        if (sidebarPositionText) sidebarPositionText.textContent = 'Menu Superior';
        if (sidebarPositionIcon) sidebarPositionIcon.textContent = '↕️';
    }
}

function toggleSidebarPosition() {
    state.sidebarPosition = state.sidebarPosition === 'side' ? 'top' : 'side';
    localStorage.setItem('hq_reader_sidebar_position', state.sidebarPosition);
    updateSidebarPositionUI();
    if (state.pdfDoc) {
        renderPage(state.pageNum);
    }
}

function toggleViewMode() {
    state.viewMode = state.viewMode === 'single' ? 'double' : 'single';

    if (state.viewMode === 'single') {
        if (viewModeText) viewModeText.textContent = 'Folha Única';
        if (viewModeIcon) viewModeIcon.textContent = '📄';
    } else {
        if (viewModeText) viewModeText.textContent = 'Modo Livro';
        if (viewModeIcon) viewModeIcon.textContent = '📖';
    }

    if (state.pdfDoc) {
        renderPage(state.pageNum);
    }
}


function closeReader() {
    readerOverlay.classList.add('hidden');
    state.pdfDoc = null;
    state.currentPDF = null;
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.removeAttribute('style');
    canvas2.removeAttribute('style');
}

// Event Listeners
function setupEventListeners() {
    btnClose.onclick = closeReader;
    btnPrev.onclick = prevPage;
    btnNext.onclick = nextPage;

    if (sidebarPositionCard) {
        sidebarPositionCard.onclick = toggleSidebarPosition;
    }

    if (viewModeCard) {
        viewModeCard.onclick = toggleViewMode;
    }




    // Keyboard Navigation
    window.addEventListener('keydown', e => {
        if (readerOverlay.classList.contains('hidden')) return;

        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
            nextPage();
        } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
            prevPage();
        } else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') {
            nextFile();
        } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') {
            prevFile();
        } else if (e.key.toLowerCase() === 'f') {

            if (state.currentPDF) toggleFavorite(state.currentPDF);
        } else if (e.key.toLowerCase() === 'r') {
            if (state.currentPDF) toggleSeen(state.currentPDF);
        } else if (e.key.toLowerCase() === 'q') {
            toggleSidebarPosition();
        } else if (e.key.toLowerCase() === 'e') {
            toggleViewMode();
        } else if (e.key === 'Escape') {
            closeReader();
        }

    });

    // Resize handler to adjust PDF canvas size dynamically
    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (readerOverlay.classList.contains('hidden')) return;
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (state.pdfDoc) {
                renderPage(state.pageNum);
            }
        }, 150);
    });


    if (btnImportFolder) {
        btnImportFolder.onclick = async () => {
            try {
                // Abre o seletor de diretório nativo e moderno
                const dirHandle = await window.showDirectoryPicker();
                
                // Obtém os arquivos de forma recursiva com caminhos relativos virtuais
                const files = await getFilesFromDirectory(dirHandle, dirHandle.name);
                
                if (files.length === 0) {
                    alert('Nenhum arquivo PDF encontrado na pasta selecionada.');
                    return;
                }

                const folders = {};

                files.forEach(file => {
                    const parts = file.relativePath.split('/');
                    if (parts.length < 2) return;
                    
                    const folderName = parts[parts.length - 2];
                    const subjectName = folderName.replace(/_/g, ' ');

                    // Check if subject already exists
                    let subject = folders[folderName] || state.library.find(s => s.folder === folderName);
                    
                    if (!subject) {
                        subject = {
                            subject: subjectName,
                            folder: folderName,
                            files: [],
                            exists: true // Foi importado, então existe
                        };
                        folders[folderName] = subject;
                        state.library.push(subject);
                    } else {
                        subject.exists = true; // Garante que ficará visível se já existia
                    }
                    
                    if (!subject.files.includes(file.name)) {
                        subject.files.push(file.name);
                    }
                });

                // Sort files alphabetically (natural sort for numbers)
                sortLibrary();
                saveLibrary();
                renderSubjects();
                
            } catch (err) {
                // Ignora se o usuário apenas cancelou o diálogo
                if (err.name !== 'AbortError') {
                    console.error('Erro ao importar pasta:', err);
                    alert('Ocorreu um erro ao acessar a pasta selecionada.');
                }
            }
        };
    }

    async function getFilesFromDirectory(dirHandle, relativePath = "") {
        const files = [];
        for await (const entry of dirHandle.values()) {
            const currentPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            if (entry.kind === 'file') {
                if (entry.name.toLowerCase().endsWith('.pdf')) {
                    files.push({
                        name: entry.name,
                        relativePath: currentPath
                    });
                }
            } else if (entry.kind === 'directory') {
                const subFiles = await getFilesFromDirectory(entry, currentPath);
                files.push(...subFiles);
            }
        }
        return files;
    }
}





init();
