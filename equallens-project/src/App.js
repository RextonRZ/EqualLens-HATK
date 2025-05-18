import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './components/pages/Home';
import UploadCV from './components/pages/UploadCV';
import SignUp from './components/pages/SignUp';
import Dashboard from './components/pages/Dashboard';
import AddInterviewQuestions from "./components/pages/AddInterviewQuestions";
import InterviewLinkValidator from './components/pages/InterviewLinkValidator';
import IDVerification from './components/pages/IDVerification';
import InterviewQuestions from './components/pages/InterviewQuestion';
import ApplicantDetails from './components/pages/ApplicantDetails';
import InterviewResponses from './components/pages/InterviewResponses';

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        {/* Main application routes */}
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Home />} />
        <Route path="/upload-cv" element={<UploadCV />} />
        <Route path="/sign-up" element={<SignUp />} />

        {/* Candidate interview routes */}
        <Route path="/interview/:interviewId/:linkCode" element={<InterviewLinkValidator />} />
        <Route path="/interview/:interviewId/:linkCode/id-verification" element={<IDVerification />} />
        <Route path="/interview/:interviewId/:linkCode/questions" element={<InterviewQuestions />} />

        {/* Dashboard route */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/:jobId/:candidateId" element={<ApplicantDetails />} />
        <Route path="/dashboard/:jobId/:candidateId/interview-responses" element={<InterviewResponses />} />

        {/* Add Interview Questions route */}
        <Route path="/add-interview-questions" element={<AddInterviewQuestions />} />
      </Routes>
    </Router>
  );
}

export default App;