var recaptchaKey = '6LcYbc0sAAAAAMH9Fh3a15V8PKy-jnArAlY1KLtm';
var recaptchaLoaded = false; // Flag to track if the reCAPTCHA script is already loaded
// Function to execute after the reCAPTCHA script loads
function runAfterRecaptchaLoaded() {
  if (!recaptchaLoaded) {
    recaptchaLoaded = true;
    grecaptcha.ready(function() {
      grecaptcha.execute(recaptchaKey, {action: 'submit'}).then(function(token) {
        // Set the generated token to the #token_generate form input.
        var response = document.querySelectorAll("[id=token_generate]");
        for (var e = 0; e < response.length; e++) {
          var responseItem = response[e];
          responseItem.value = token;
        }
      });
    });
  }
}
// Function to load the reCAPTCHA script dynamically
function loadRecaptchaScript() {
  var script = document.createElement('script');
  script.src = 'https://www.google.com/recaptcha/api.js?render=' + recaptchaKey;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
  script.onload = runAfterRecaptchaLoaded; // Execute runAfterRecaptchaLoaded once the script is loaded
}
// Function to check if the form is close to the viewport
function checkFormCloseToViewport() {
  var form = document.querySelector("form"); // Replace "recaptcha-form" with the actual class of your form
  if (form) {
    var options = {
      root: null,
      rootMargin: '0px',
      threshold: 0.1 // Change this threshold value as needed
    };
    var observer = new IntersectionObserver(function(entries, observer) {
      entries.forEach(function(entry) {
        if (entry.intersectionRatio >= 0.1) { // Execute the code when the form is close to 10% visible
          observer.unobserve(entry.target); // Stop observing once the form is close to the viewport
          loadRecaptchaScript(); // Load the reCAPTCHA script after 5 seconds
        }
      });
    }, options);
    observer.observe(form);
  }
}
// Use the "DOMContentLoaded" event to start checking for the form visibility.
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(loadRecaptchaScript, 5000); // Load the reCAPTCHA script after 5 seconds
  checkFormCloseToViewport(); // Start checking for the form visibility immediately
}); 
