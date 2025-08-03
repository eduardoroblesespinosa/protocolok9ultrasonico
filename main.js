import 'bootstrap';

// DOM Elements
const frequencySlider = document.getElementById('frequency-slider');
const frequencyDisplay = document.getElementById('frequency-display');
const playButton = document.getElementById('play-whistle');
const visualizerCanvas = document.getElementById('visualizer-canvas');
const dogSilhouette = document.getElementById('dog-silhouette');
const trainingAccordion = document.getElementById('trainingAccordion');
const responseBar = document.getElementById('response-bar');
const responseText = document.getElementById('responseText');
const canvasCtx = visualizerCanvas.getContext('2d');

// Certification Elements
const startExamBtn = document.getElementById('start-exam-btn');
const operatorNameInput = document.getElementById('operator-name');
const certificationIntro = document.getElementById('certification-intro');
const examProgressView = document.getElementById('exam-progress-view');
const examInstruction = document.getElementById('exam-instruction');
const examProgressBar = document.getElementById('exam-progress-bar');
const examFeedback = document.getElementById('exam-feedback');
const restartExamBtn = document.getElementById('restart-exam-btn');
const printCertificateBtn = document.getElementById('print-certificate-btn');
const certificateModalEl = document.getElementById('certificateModal');
const certificateModal = new bootstrap.Modal(certificateModalEl);

let audioContext;
let oscillator;
let gainNode;
let analyser;
let isPlaying = false;
let timeoutId = null;
let animationFrameId = null;
let pulseInterval = null;

// --- AUDIO ASSETS ---
let hissBuffer = null;
let correctSoundBuffer = null;
let incorrectSoundBuffer = null;
let hissSourceNode = null; // To control the looping hiss

const optimalFrequencies = [23, 25, 35, 42.5, 50];
const MAX_EFFECTIVE_DISTANCE = 4.0; // The max kHz away from an optimal freq to have any effect

// --- EXAM STATE ---
let examInProgress = false;
let currentQuestionIndex = 0;
let examScenarios = [];

const allScenarios = [
    { name: "Eco de Beijing", description: "Ordene al K9 que se detenga y regrese desde una larga distancia.", frequency: 35 },
    { name: "Sombra Silenciosa", description: "Inicie el protocolo de rastreo sigiloso.", frequency: 42.5 },
    { name: "Furia Controlada (Liberación)", description: "Ordene al K9 que suelte su objetivo.", frequency: 25 },
    { name: "Guardián de la Muralla", description: "Indique al K9 que todo está despejado.", frequency: 23 },
    { name: "Furia Controlada (Ataque)", description: "Autorice la intervención y apresamiento.", frequency: 50 }
];

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- CORE FUNCTIONS ---

// Load audio assets as soon as the page is interacted with
async function loadAudioFile(url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        if (!audioContext) setupAudio();
        return await audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.error(`Error loading audio file ${url}:`, error);
        return null;
    }
}

async function initAudioAssets() {
    hissBuffer = await loadAudioFile('whistle_hiss.mp3');
    correctSoundBuffer = await loadAudioFile('exam_correct.mp3');
    incorrectSoundBuffer = await loadAudioFile('exam_incorrect.mp3');
}

function playSoundEffect(buffer) {
    if (!buffer || !audioContext) return;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
}

function calculateEffectiveness(currentFreq) {
    let minDistance = Infinity;
    optimalFrequencies.forEach(optimalFreq => {
        const distance = Math.abs(currentFreq - optimalFreq);
        if (distance < minDistance) {
            minDistance = distance;
        }
    });

    if (minDistance > MAX_EFFECTIVE_DISTANCE) {
        return 0;
    }

    // Linear falloff from 100%
    return 100 * (1 - (minDistance / MAX_EFFECTIVE_DISTANCE));
}

function updateResponseMeter(freq) {
    const effectiveness = calculateEffectiveness(freq);

    responseBar.style.width = `${effectiveness}%`;
    responseBar.setAttribute('aria-valuenow', effectiveness);

    responseBar.classList.remove('bg-success', 'bg-warning', 'bg-danger');

    if (effectiveness > 85) {
        responseBar.classList.add('bg-success');
        responseText.textContent = 'Respuesta Óptima: Comando claro y preciso.';
        responseText.style.color = '#198754';
    } else if (effectiveness > 40) {
        responseBar.classList.add('bg-warning');
        responseText.textContent = 'Respuesta Parcial: El K9 puede dudar o confundirse.';
         responseText.style.color = '#ffc107';
    } else if (effectiveness > 0) {
        responseBar.classList.add('bg-danger');
        responseText.textContent = 'Respuesta Débil: Es poco probable que el comando sea obedecido.';
        responseText.style.color = '#dc3545';
    } else {
        responseText.textContent = 'Sin Respuesta: Frecuencia fuera del rango de entrenamiento.';
        responseText.style.color = 'var(--bs-secondary-color)';
    }
}

function setFrequency(freq) {
    const frequency = parseFloat(freq);
    frequencySlider.value = frequency;
    frequencyDisplay.textContent = `${frequency.toFixed(1)} kHz`;
    updateResponseMeter(frequency);
}

// Update display when slider moves
frequencySlider.addEventListener('input', () => {
    setFrequency(frequencySlider.value);
});

// Set frequency from accordion buttons
trainingAccordion.addEventListener('click', (e) => {
    if (examInProgress) return;
    const target = e.target.closest('[data-frequency]');
    if (!target) return;

    const freq = target.dataset.frequency;
    setFrequency(freq);
});

// Web Audio API setup
function setupAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
    }
}

function mapToAudible(ultrasonicKHz) {
    const ultrasonicMin = 23;
    const ultrasonicMax = 54;
    const audibleMin = 440; // A4
    const audibleMax = 1200; // D6
    
    // Map the slider value from its range to the audible frequency range
    const percentage = (ultrasonicKHz - ultrasonicMin) / (ultrasonicMax - ultrasonicMin);
    return audibleMin + (percentage * (audibleMax - audibleMin));
}

function playSound() {
    if (isPlaying) return;
    
    // Exam Logic Check
    if (examInProgress) {
        checkExamAnswer();
    }
    
    setupAudio();
    isPlaying = true;
    dogSilhouette.classList.add('active');

    const signalType = document.querySelector('input[name="signal-type"]:checked').value;

    if (signalType === 'pulse') {
        let on = true;
        pulseInterval = setInterval(() => {
            if (on) {
                startTone();
            } else {
                stopTone();
            }
            on = !on;
        }, 200); // 200ms on, 200ms off
    } else {
        startTone();
    }
    
    playButton.classList.add('active');
    playButton.innerHTML = `<i class="bi bi-volume-mute-fill me-2"></i>Detener Silbato`;

    // Play looping hiss for audible feedback
    if (hissBuffer && !hissSourceNode) {
        hissSourceNode = audioContext.createBufferSource();
        hissSourceNode.buffer = hissBuffer;
        hissSourceNode.loop = true;
        hissSourceNode.connect(audioContext.destination);
        hissSourceNode.start();
    }

    draw(); // Start visualization
}

function startTone() {
    if (oscillator) {
        oscillator.stop();
    }
    
    oscillator = audioContext.createOscillator();
    gainNode = audioContext.createGain();

    const ultrasonicFrequency = parseFloat(frequencySlider.value);
    const ultrasonicFrequencyHz = ultrasonicFrequency * 1000; // Convert kHz to Hz
    
    oscillator.frequency.setValueAtTime(ultrasonicFrequencyHz, audioContext.currentTime); 
    oscillator.type = 'sine';

    oscillator.connect(gainNode);
    gainNode.connect(analyser);
    // We don't connect the analyser to the destination, as it's ultrasonic and shouldn't be played
    // analyser.connect(audioContext.destination);

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.05);

    oscillator.start();
}

function stopTone() {
    if (gainNode) {
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
    }
}

function stopSound() {
    if (!isPlaying) return;

    if (pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
    
    // Stop the hiss sound
    if (hissSourceNode) {
        hissSourceNode.stop();
        hissSourceNode = null;
    }

    if (oscillator) {
        gainNode.gain.cancelScheduledValues(audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.2);
        oscillator.stop(audioContext.currentTime + 0.2);
        oscillator.onended = () => {
             // Clean up happens once after the final stop
        };
    }

    isPlaying = false;
    dogSilhouette.classList.remove('active');
    playButton.classList.remove('active');
    playButton.innerHTML = `<i class="bi bi-volume-up-fill me-2"></i>Activar Silbato`;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Clear canvas after sound stops
    setTimeout(() => {
            canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    }, 200);
}

function draw() {
    if (!isPlaying) return;
    animationFrameId = requestAnimationFrame(draw);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = 'rgb(27, 38, 59)'; // Match card background
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = '#778da9'; // Primary color

    canvasCtx.beginPath();
    const sliceWidth = visualizerCanvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * visualizerCanvas.height / 2;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    canvasCtx.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
    canvasCtx.stroke();
}

// Event listener for the play/stop button
playButton.addEventListener('click', () => {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    if (isPlaying) {
        stopSound();
    } else {
        playSound();
    }
});

// --- EXAM FUNCTIONS ---

function startExam() {
    const operatorName = operatorNameInput.value.trim();
    if (operatorName === '') {
        alert('Por favor, ingrese su nombre para iniciar el examen.');
        return;
    }

    examInProgress = true;
    currentQuestionIndex = 0;
    shuffleArray(allScenarios);
    examScenarios = allScenarios;

    operatorNameInput.disabled = true;
    trainingAccordion.style.opacity = '0.5';
    trainingAccordion.style.pointerEvents = 'none';
    
    certificationIntro.classList.add('d-none');
    examProgressView.classList.remove('d-none');
    restartExamBtn.classList.add('d-none');
    examFeedback.innerHTML = '';

    presentQuestion();
}

function presentQuestion() {
    if (currentQuestionIndex >= examScenarios.length) {
        passExam();
        return;
    }
    const scenario = examScenarios[currentQuestionIndex];
    examInstruction.textContent = `Prueba ${currentQuestionIndex + 1}: ${scenario.description}`;
    updateExamProgress();
}

function updateExamProgress() {
    const progress = (currentQuestionIndex / examScenarios.length) * 100;
    examProgressBar.style.width = `${progress}%`;
    examProgressBar.textContent = `${currentQuestionIndex}/${examScenarios.length}`;
}

function checkExamAnswer() {
    const currentFreq = parseFloat(frequencySlider.value);
    const targetFreq = examScenarios[currentQuestionIndex].frequency;

    if (Math.abs(currentFreq - targetFreq) < 1.0) { // Tolerance of 1.0 kHz
        playSoundEffect(correctSoundBuffer);
        examFeedback.innerHTML = `<span class="text-success fw-bold"><i class="bi bi-check-circle-fill me-2"></i>Correcto. Procediendo a la siguiente prueba.</span>`;
        currentQuestionIndex++;
        setTimeout(() => {
            examFeedback.innerHTML = '';
            presentQuestion();
        }, 1500);
    } else {
        playSoundEffect(incorrectSoundBuffer);
        failExam();
    }
}

function passExam() {
    examInstruction.textContent = 'Examen Completado';
    examFeedback.innerHTML = `<span class="text-success fw-bold"><i class="bi bi-patch-check-fill me-2"></i>¡Felicidades! Ha superado la certificación.</span>`;
    updateExamProgress();
    
    setTimeout(() => {
        showCertificate();
        endExam();
    }, 2000);
}

function failExam() {
    examFeedback.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-x-octagon-fill me-2"></i>Incorrecto. Frecuencia no corresponde al protocolo. Examen fallido.</span>`;
    restartExamBtn.classList.remove('d-none');
    endExam();
}

function endExam(reset = false) {
    examInProgress = false;
    operatorNameInput.disabled = false;
    trainingAccordion.style.opacity = '1';
    trainingAccordion.style.pointerEvents = 'auto';

    if (reset) {
        certificationIntro.classList.remove('d-none');
        examProgressView.classList.add('d-none');
        examProgressBar.style.width = `0%`;
        examProgressBar.textContent = `0/${examScenarios.length}`;
    }
}

function showCertificate() {
    const operatorName = operatorNameInput.value.trim();
    document.getElementById('certificate-name').textContent = operatorName || "Operador Certificado";
    document.getElementById('certificate-date').textContent = new Date().toLocaleDateString('es-ES', {
        year: 'numeric', month: 'long', day: 'numeric'
    });
    certificateModal.show();
}

// --- EVENT LISTENERS ---

startExamBtn.addEventListener('click', startExam);
restartExamBtn.addEventListener('click', () => endExam(true));
printCertificateBtn.addEventListener('click', () => {
    // Temporarily hide the modal footer for printing
    certificateModalEl.querySelector('.modal-footer').classList.add('d-none');
    window.print();
    certificateModalEl.querySelector('.modal-footer').classList.remove('d-none');
});


// Initial state setup
document.addEventListener('DOMContentLoaded', () => {
    setFrequency(frequencySlider.value);
    // A user gesture is needed to initialize AudioContext and load assets
    const initInteraction = () => {
        setupAudio();
        initAudioAssets();
        document.body.removeEventListener('click', initInteraction);
        document.body.removeEventListener('keydown', initInteraction);
    };
    document.body.addEventListener('click', initInteraction, { once: true });
    document.body.addEventListener('keydown', initInteraction, { once: true });
});