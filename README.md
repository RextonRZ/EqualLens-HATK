# HackAttack 2.0
# EqualLens - AI-Powered Talent Acquisition System

EqualLens is an advanced AI-powered Talent Acquisition System designed to revolutionize the hiring process by enhancing efficiency, ensuring fairness, and improving the quality of hires. It addresses the critical challenges faced by modern HR departments, such as managing high volumes of applications, mitigating unconscious bias, verifying candidate authenticity, and streamlining the entire recruitment lifecycle from job posting creation to interview analysis.

## Table of Contents

- [Introduction](#introduction)
- [Problem Statement](#problem-statement)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [System Architecture](#system-architecture)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Usage](#usage)
- [Authors](#authors)

## Introduction

Traditional talent acquisition is often a cumbersome, time-consuming, and subjective process. HR teams can be overwhelmed by thousands of applications for a single role, which complicates identifying top talent effectively and without bias. Application spam, including AI-generated or fraudulent resumes, further exacerbates this issue, wasting time and often leading to suboptimal hiring decisions.

EqualLens provides a comprehensive, end-to-end solution that leverages cutting-edge AI to automate and enhance every step of the recruitment pipeline. From intelligent job description assistance to multi-layered authenticity checks and AI-powered interview analysis, EqualLens empowers organizations to hire smarter, faster, and more fairly.

## Problem Statement

The core problem is inefficiency, potential bias, and a lack of robust verification in traditional talent acquisition processes. Specifically:

- **Overwhelming Application Volume**: HR teams struggle to manually screen hundreds of resumes, leading to missed talent and prolonged hiring cycles. Recruiters spend an average of only 6-7 seconds initially reviewing a resume.

- **Application Spam & Authenticity**: The rise of easily generated resumes (including AI-written ones) and application spam from unqualified candidates burdens recruiters and risks the integrity of the hiring process.

- **Unconscious Bias**: Human screeners can inadvertently introduce bias based on demographic information, names, or even the phrasing of a resume. Job descriptions themselves can also contain biased language that deters certain candidate pools.

- **Inefficient Candidate-Job Matching**: Manually assessing the true fit between a candidate's complex profile and nuanced job requirements is difficult and subjective.

- **Lack of Standardization**: Different recruiters may evaluate candidates differently, leading to inconsistent outcomes.

- **Time-Intensive Interviewing**: Scheduling, conducting, and consistently evaluating interviews across many candidates is a logistical and analytical burden.

## Key Features

EqualLens offers a comprehensive suite of features to address these challenges:

### 1. Intelligent Job Posting Assistance
- **AI Suggestions**: Generate compelling job descriptions and requirements based on a job title and optional context.
- **Bias Detection**: Analyze job posting text for potentially biased language related to age, gender, race, etc., and provides highlighting and suggestions for more inclusive alternatives.

### 2. Bulk CV Upload & Management
- **Multi-Format Support**: Seamlessly upload and process multiple CVs in PDF, DOC, and DOCX formats.
- **Centralized System**: Manage all job postings and their respective candidate pools from a unified dashboard.

### 3. Advanced Document Parsing
- **Automated Data Extraction**: Utilizes Google Document AI to accurately parse and extract key structured information from resumes, including contact details, skills, experience, and education.

### 4. Multi-Layered Authenticity & Spam Detection
- **External AI Model Prediction**: Integrates with an external model to assess if resume content is AI-generated or human-written.
- **Internal Authenticity Scanning**: Proprietary analysis of content specificity, AI stylistic indicators, timeline coherence, and overall plausibility.
- **Cross-Referencing Analysis**: Verifies entities (companies, institutions) and URLs mentioned in resumes against external data sources.
- **Relevancy Analysis**: Analyzes technical and soft skills to ensure candidates possess the required qualifications for the job.
- **Duplicate Detection**: Identifies exact, modified, or copied resumes, allowing for informed overwrite decisions.

### 5. AI-Driven Candidate Ranking
- **Configurable Criteria**: Rank applicants based on a configurable mix of skills, experience, education, and cultural fit.
- **Explainable AI**: Provides detailed reasoning and score breakdowns for each candidate's rank, fostering transparency and trust in the AI's assessment.
- **Visualizations**: Offers intuitive charts and graphs to visualize score distributions and candidate comparisons.

### 6. Detailed Candidate Profiling
- **Comprehensive Summaries**: AI generates concise, insightful summaries of each candidate's profile, highlighting strengths and key qualifications.
- **Inferred Skills**: Identifies and suggests skills that are implied by the resume content but not explicitly listed.
- **Relevance Analysis**: Scores and highlights skills and experiences based on their relevance to the specific job description.

### 7. Automated Interview System
- **AI-Tailored Questions**: Generates tailored interview question sets based on job requirements and individual candidate profiles, with full manual control for recruiters.
- **Secure Interview Links & ID Verification**: Creates unique, time-limited interview links with integrated facial recognition and name matching against ID documents for enhanced security.
- **Automated Response Capture**: Candidates record video/audio responses to structured questions within set time limits.
- **Transcription & PII Censorship**: Automatically transcribes interview audio to text and provides tools for redacting Personal Identifiable Information (PII) and potentially biased terms from both text and audio.
- **AI-Powered Analysis**: Evaluates interview responses on multiple dimensions including clarity, confidence, engagement, relevance, substance, and job fit. Includes facial expression interpretation and AI-generated feedback for each answer.

## Technology Stack

- **Frontend**: React.js, React Router, Axios, Chart.js, Recharts, jsPDF, html2canvas
- **Backend**: Python 3.10+, FastAPI, Uvicorn
- **Database & Storage**: Firebase Firestore, Firebase Storage
- **AI & Machine Learning**:
  - **LLMs**: Google Gemini (Primary), Google Gemma (Fallback)
  - **Google Cloud AI**: Document AI, Cloud Vision AI, Speech-to-Text API, Natural Language API
  - **Audio/Video Processing**: MediaPipe, Librosa, FFmpeg, PyDub, OpenCV
  - **Text & NLP**: Sentence Transformers, NLTK, Scikit-learn, TF-IDF
- **Development & Deployment**: Git, GitHub, Docker, Google Cloud Platform (GCP)

## System Architecture

The system is built on a modern, decoupled architecture:

- **React Frontend**: A dynamic single-page application (SPA) that provides the user interface for HR managers and recruiters. It communicates with the backend via a RESTful API.

- **FastAPI Backend**: A high-performance Python backend that serves as the core of the application. It handles business logic, data processing, and orchestrates calls to various AI services.

- **Firebase**: Acts as the primary data persistence layer.
  - **Firestore**: A NoSQL database used to store all structured data, including jobs, candidates, applications, and interview responses.
  - **Firebase Storage**: Used for storing unstructured files like CVs, ID verification images, and interview video recordings.

- **Google Cloud AI & External Services**: The backend integrates with a suite of powerful AI services to provide its intelligent features:
  - Document AI for parsing resumes.
  - Gemini/Gemma for all major generative and analytical AI tasks.
  - Cloud Vision & Speech-to-Text for the interview module.
  - External AI Detector for an additional layer of resume authenticity checking.

This architecture ensures scalability, maintainability, and the flexibility to integrate new AI models and services as they become available.

## API Endpoints

The backend exposes a set of RESTful API endpoints for the frontend to consume.

### Jobs (`/api/jobs`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get a list of all jobs. |
| POST | `/upload-job` | Create a new job and upload initial CVs. |
| POST | `/upload-more-cv` | Upload additional CVs to an existing job. |
| GET | `/{job_id}` | Get details for a specific job by its ID. |
| PUT | `/{job_id}` | Update the details of an existing job. |
| POST | `/suggest-details` | Get AI-generated suggestions for a job description. |

### Candidates (`/api/candidates`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/applicants` | Get all applicants for a specific job. |
| GET | `/candidates` | Get all candidates for a specific job. |
| GET | `/candidate/{candidate_id}` | Get details for a specific candidate. |
| PUT | `/candidate/{candidate_id}` | Update a candidate's data (e.g., add detailed profile). |
| GET | `/detail/{candidate_id}` | Generate/retrieve a detailed AI profile for a candidate. |
| POST | `/rank` | Rank a list of applicants based on a prompt. |
| POST | `/ranks` | Rank applicants based on predefined weights. |
| POST | `/rerank` | Re-rank candidates for a job. |
| POST | `/overwrite` | Overwrite a candidate's data with a new CV. |
| GET | `/overwrite-target` | Get the target candidate ID for an overwrite operation. |
| PUT | `/update-status/{application_id}` | Update the status of a candidate's application. |

### Interviews (`/api/interviews`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/generate-link` | Generate a unique interview link for a candidate. |
| GET | `/validate/{interview_id}/{link_code}` | Validate an interview link before starting. |
| POST | `/verify-identity` | Process ID verification with a selfie and ID card image. |
| GET | `/questions/{interview_id}/{link_code}` | Get the list of questions for an interview. |
| POST | `/generate-upload-url` | Generate a signed URL for direct video upload to GCS. |
| POST | `/submit-response` | Submit interview response metadata for processing. |
| POST | `/complete-interview` | Mark an interview as completed and finalize scores. |
| POST | `/abandon-interview` | Mark an interview as abandoned. |
| GET | `/responses/{application_id}` | Get all interview responses for an application. |
| POST | `/generate-feedback` | Generate AI feedback for interview responses. |
| POST | `/reject` / `/send-rejection` | Reject a candidate and send a rejection email. |
| POST | `/send-offer` | Send a job offer email to a candidate. |
| POST | `/schedule-physical` | Schedule a physical interview and send an email. |

### Interview Questions (`/api/interview-questions`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/question-set` | Create a new set of interview questions. |
| GET | `/question-set/{application_id}` | Get the question set for a specific application. |
| DELETE | `/question-set/{application_id}` | Delete a question set. |
| POST | `/save-question-set` | Save or update a question set. |
| POST | `/apply-to-all` | Apply a question set to all candidates for a job. |
| POST | `/generate-actual-questions/{application_id}` | Generate the final, randomized list of questions for an interview. |

### Bias Detection (`/api/bias-detection`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/analyze` | Analyze a job posting for potential bias. |

## Project Structure

```
.
├── backend/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── candidates.py
│   │   ├── interviews.py
│   │   ├── jobs.py
│   │   ├── interview_questions.py
│   │   └── bias_detection_requests.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── firebase.py
│   │   └── text_similarity.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── ai_detection.py
│   │   ├── authenticity_analysis.py
│   │   ├── bias_detection_request.py
│   │   ├── candidate.py
│   │   ├── cross_referencing.py
│   │   ├── interview.py
│   │   ├── interview_question.py
│   │   └── job.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── ai_detection_service.py
│   │   ├── bias_detection_request_service.py
│   │   ├── candidate_service.py
│   │   ├── cross_referencing_service.py
│   │   ├── document_service.py
│   │   ├── external_ai_detection_service.py
│   │   ├── face_verification.py
│   │   ├── gemma_service.py
│   │   ├── gemini_IVQuestionService.py
│   │   ├── gemini_service.py
│   │   ├── inferred_skills_explanation_service.py
│   │   ├── interview_service.py
│   │   ├── iv_ques_finalized_service.py
│   │   ├── iv_ques_store_service.py
│   │   ├── job_service.py
│   │   ├── raw_text_extractor.py
│   │   ├── resume_authenticity_service.py
│   │   └── scoring_aggregation_service.py
│   ├── main.py
│   └── firebase_config.json
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── modals/ (AIConfirmationModal, DuplicateFilesModal, etc.)
│   │   │   ├── Navbar.js
│   │   │   └── ...
│   │   ├── pages/
│   │   │   ├── Dashboard.js
│   │   │   ├── ApplicantDetails.js
│   │   │   ├── UploadCV.js
│   │   │   └── ...
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
├── .env
└── requirements.txt
```

## Installation & Setup

Follow these steps to set up and run the EqualLens project on your local machine.

### Prerequisites

- Python 3.10 or higher
- Node.js and npm (or yarn)
- FFmpeg installed and available in your system's PATH
- Access to Google Cloud Platform with the following APIs enabled:
  - Document AI API
  - Cloud Vision AI API
  - Speech-to-Text API
  - Natural Language API
  - Generative Language API (for Gemini)

### 1. Clone the Repository

```bash
git clone https://your-repository-url/equallens.git
cd equallens
```

### 2. Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

Install Python dependencies:

```bash
pip install -r ../requirements.txt
```

**Firebase Configuration:**
- Obtain your Firebase service account key JSON file from the Firebase Console.
- Place it in the `backend/` directory and name it `firebase_config.json`. The application is configured to look for this file.

**Environment Variables:**
- Create a `.env` file in the root directory of the project (alongside `requirements.txt`).
- Populate it with the necessary API keys and configuration details. Use the provided `.env` file as a template.

```env
# .env
DOCUMENTAI_PROJECT_ID=your-gcp-project-id
DOCUMENTAI_LOCATION=us # or your processor's location
DOCUMENTAI_PROCESSOR_ID=your-docai-processor-id
DOCUMENTAI_PROCESSOR_VERSION=your-docai-processor-version

SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-gmail-app-password

FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com

GEMINI_API_KEY=YOUR_GEMINI_API_KEY

# Path to the downloaded MediaPipe model
FACE_LANDMARKER_MODEL_PATH=path/to/your/backend/models/face_landmarker.task

# URL for the logo in emails
EMAIL_LOGO_URL=https://your-public-logo-url.png

# Hugging Face and GitHub tokens for accessing models and APIs
HUGGINGFACE_TOKEN=hf_YOUR_HUGGINGFACE_TOKEN
GITHUB_API_TOKEN=ghp_YOUR_GITHUB_TOKEN

# URL for the external resume classifier service
EXTERNAL_AI_DETECTOR_URL=https://your-classifier-url.run.app/predict
```

### 3. Frontend Setup

Navigate to the frontend directory:

```bash
cd frontend
```

Install Node.js dependencies:

```bash
npm install
```

## Usage

### Running the Backend Server

From the backend directory, run the following command:

```bash
uvicorn main:app --reload
```

The backend API will be available at `http://localhost:8000`. You can access the auto-generated API documentation at `http://localhost:8000/docs`.

### Running the Frontend Application

From the frontend directory, run the following command:

```bash
npm start
```

The React application will start and should open in your default web browser at `http://localhost:3000`.

## Authors

- **Lim Hong Yu**
- **Ooi Rui Zhe**
- **Vanness Liu Chuen Wei**
- **Khor Rui Zhe**
