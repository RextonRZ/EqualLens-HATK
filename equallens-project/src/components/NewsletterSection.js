import React, { useState } from 'react';
import './NewsletterSection.css';

const NewsletterSection = () => {
    const [email, setEmail] = useState('');
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [error, setError] = useState('');
    
    const validateEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };
    
    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Here you would typically send the email to your API
        console.log('Subscribing email:', email);
        
        // Show success message
        setIsSubmitted(true);
        setError('');
        
        // Reset form after 5 seconds
        setTimeout(() => {
            setIsSubmitted(false);
            setEmail('');
        }, 5000);
    };
    
    return (
        <section className="newsletter-section" id="newsletter">
            <div className="newsletter-overlay"></div>
            <div className="newsletter-container">

                <div className="newsletter-content">
                    <div className="newsletter-text">
                        <h2>Stay in the Loop</h2>
                        <p>Subscribe for insights on unbiased hiring, AI recruitment, and exclusive EqualLens updates.</p>
                    </div>
                    
                    <div className="newsletter-form-container">
                        {!isSubmitted ? (
                            <form onSubmit={handleSubmit} className="newsletter-form">
                                <div className="input-group-news">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => {
                                            setEmail(e.target.value);
                                            setError('');
                                        }}
                                        placeholder="Enter your email address"
                                        className={error ? 'error' : ''}
                                    />
                                    <button type="submit" className="subscribe-btn">
                                        Subscribe <span className="btn-arrow">→</span>
                                    </button>
                                </div>
                                <p className="privacy-note">We respect your privacy. Unsubscribe at any time.</p>
                            </form>
                        ) : (
                            <div className="success-message">
                                <div className="news-icon">✓</div>
                                <h3>Thank you!</h3>
                                <p>Welcome to the EqualLens community.</p>
                            </div>
                        )}
                    </div>
                </div>
                
                <div className="newsletter-decoration">
                    <div className="floating-circle circle-1"></div>
                    <div className="floating-circle circle-2"></div>
                    <div className="floating-circle circle-3"></div>
                </div>
            </div>
        </section>
    );
};

export default NewsletterSection;
