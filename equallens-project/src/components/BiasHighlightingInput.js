import React, { useState, useRef, useEffect } from 'react';
import './BiasHighlightingInput.css';

const BiasHighlightingInput = ({
    value,
    onChange,
    biasedTerms = [],
    placeholder = '',
    className = '',
    suggestions = [], // Add suggestions prop
    onSuggestionSelect = () => {}, // Callback for suggestion selection
    ...props
}) => {
    const editorRef = useRef(null);
    const [isFocused, setIsFocused] = useState(false);
    const [filteredSuggestions, setFilteredSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const lastCursorPosition = useRef(null);

    // Get current cursor position
    const getCursorPosition = () => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return 0;

        const range = selection.getRangeAt(0);
        return {
            node: range.startContainer,
            offset: range.startOffset
        };
    };

    // Set cursor position
    const setCursorPosition = (position) => {
        if (!position || !editorRef.current) return;

        setTimeout(() => {
            try {
                // Handle case where we want to set position in text node
                let target = editorRef.current;
                let nodes = [];

                // Get all text nodes in the editor
                const getTextNodes = (node) => {
                    if (node.nodeType === 3) { // Text node
                        nodes.push(node);
                    } else {
                        for (let i = 0; i < node.childNodes.length; i++) {
                            getTextNodes(node.childNodes[i]);
                        }
                    }
                };

                getTextNodes(editorRef.current);

                // Find the right text node and set position
                if (nodes.length > 0) {
                    // The simplest approach - set cursor to end
                    const lastNode = nodes[nodes.length - 1];
                    const range = document.createRange();
                    range.setStart(lastNode, lastNode.textContent.length);
                    range.collapse(true);

                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            } catch (e) {
                console.error('Error setting cursor position', e);
            }
        }, 0);
    };

    // Handle input changes
    const handleInput = (e) => {
    // Save cursor position before updating state
    lastCursorPosition.current = getCursorPosition();

    const plainText = e.target.innerText || '';

    // Check if text is the placeholder and don't update state in that case
    if (plainText === placeholder) {
        return;
    }

    // This is where we need to ensure the parent state gets updated
    onChange({ target: { value: plainText } });

    // Show placeholder if input is empty
    if (!plainText.trim()) {
        editorRef.current.innerText = ''; // Clear the input
        editorRef.current.classList.add('empty');
    } else {
        editorRef.current.classList.remove('empty');
    }

    // Filter suggestions based on input
    if (suggestions.length > 0) {
        const filtered = suggestions.filter((suggestion) =>
            suggestion.toLowerCase().includes(plainText.toLowerCase())
        );
        setFilteredSuggestions(filtered);
        setShowSuggestions(filtered.length > 0);
    }
};

    const handleSuggestionClick = (suggestion) => {
        onSuggestionSelect(suggestion);
        setShowSuggestions(false);
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        document.execCommand('insertText', false, text); // Insert plain text only
    };

    // Initialize the editor content
    useEffect(() => {
        if (!editorRef.current) return;

        // Initial setup only - don't interfere with active editing
        if (editorRef.current.innerHTML === '') {
            if (value) {
                editorRef.current.innerText = value;
                editorRef.current.classList.remove('empty');
            } else {
                editorRef.current.innerText = ''; // Just clear it
                editorRef.current.classList.add('empty');
            }
        }
    }, []);

    // Apply highlighting only when not focused and content changes
    // Update the useEffect that initializes the editor to work with changing values
    useEffect(() => {
        if (!editorRef.current) return;

        // Update content when value changes from parent, but only if not focused
        // to avoid interrupting user editing
        if (!isFocused) {
            // Store current scroll position
            const scrollTop = editorRef.current.scrollTop;

            if (!value) {
                editorRef.current.innerText = '';
                editorRef.current.classList.add('empty');
            } else {
                if (biasedTerms && biasedTerms.length > 0) {
                    let content = value;

                    biasedTerms.forEach(term => {
                        if (!term) return;
                        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`\\b(${escapedTerm})\\b`, 'gi');
                        content = content.replace(regex, '<span class="bias-highlight">$1</span>');
                    });

                    // Preserve original spacing by replacing newlines with <br>
                    content = content.replace(/\n/g, '<br>');

                    editorRef.current.innerHTML = content;
                } else {
                    editorRef.current.innerHTML = value.replace(/\n/g, '<br>'); // Preserve spacing
                }

                editorRef.current.classList.remove('empty');
            }

            // Restore scroll position
            editorRef.current.scrollTop = scrollTop;
        }
    }, [value, biasedTerms, placeholder, isFocused]);

    useEffect(() => {
    // When value changes from parent and doesn't match our content,
    // update if not focused to prevent loops
    if (editorRef.current && !isFocused) {
        const currentContent = editorRef.current.innerText;
        if (value !== currentContent && value !== undefined) {
            // Only update from parent if not currently focused
            if (!document.activeElement || document.activeElement !== editorRef.current) {
                // Use class checks instead of directly setting innerText to maintain placeholder
                if (!value || !value.trim()) {
                    editorRef.current.innerText = '';
                    editorRef.current.classList.add('empty');
                } else {
                    editorRef.current.innerText = value;
                    editorRef.current.classList.remove('empty');
                }
            }
        }
    }
}, [value, isFocused]);


    // Update the handleFocus function to properly handle focus events
    const handleFocus = (e) => {
        if (editorRef.current) {
            editorRef.current.classList.add('focused');
            setIsFocused(true);

            if (editorRef.current.innerText === placeholder) {
                // Clear the input when focused if it contains only the placeholder
                editorRef.current.innerText = '';
                editorRef.current.classList.remove('empty');
            } else if (biasedTerms && biasedTerms.length > 0) {
                // Keep the highlighting initially but let CSS transition it
                setTimeout(() => {
                    // Only replace with plain text if still focused
                    if (document.activeElement === editorRef.current && editorRef.current) {
                        // Save scroll position
                        const scrollTop = editorRef.current.scrollTop;

                        // Update with plain text version
                        editorRef.current.innerText = value || '';

                        // Restore scroll position
                        editorRef.current.scrollTop = scrollTop;

                        // Set cursor to end if appropriate
                        if (!lastCursorPosition.current) {
                            const textNode = editorRef.current.firstChild || editorRef.current;
                            const range = document.createRange();
                            const selection = window.getSelection();

                            if (textNode) {
                                const length = textNode.nodeType === 3 ? textNode.length : 0;
                                range.setStart(textNode, length);
                                range.collapse(true);
                                selection.removeAllRanges();
                                selection.addRange(range);
                            }
                        }
                    }
                }, 200);
            }
        }
    };

    // Handle blur
    // Update the handleBlur function to properly preserve content
    const handleBlur = () => {
        setTimeout(() => setShowSuggestions(false), 200); // Delay to allow click event

        if (editorRef.current) {
            const content = editorRef.current.innerText.trim();

            // Make sure to update the parent state with the current content before losing focus
            if (content !== value) {
                onChange({ target: { value: content } });
            }

            if (!content) {
                // Don't set innerText to placeholder, just add the empty class
                editorRef.current.innerText = '';
                editorRef.current.classList.add('empty');
            }
        }

        // Set isFocused to false AFTER updating parent state to prevent content being overwritten
        setIsFocused(false);
    };

    // Handle keydown
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !props.multiline) {
            e.preventDefault();
        }
    };

    return (
        <div className={`bias-highlighting-input-container ${className}`}>
            <div
                ref={editorRef}
                className={`bias-highlighting-input ${!value ? 'empty' : ''} ${props.multiline ? 'multiline' : 'single-line'} ${isFocused ? 'focused' : ''}`}
                contentEditable="true"
                onInput={handleInput}
                onPaste={handlePaste} // Handle paste event
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                data-placeholder={placeholder} // Use this attribute for CSS to show placeholder
                data-multiline={props.multiline ? "true" : "false"}
                {...props}
            ></div>
            {showSuggestions && (
                <ul className="suggestions-list">
                    {filteredSuggestions.map((suggestion, index) => (
                        <li
                            key={index}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                handleSuggestionClick(suggestion);
                            }}
                        >
                            {suggestion}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default BiasHighlightingInput;