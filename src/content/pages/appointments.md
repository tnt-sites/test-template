---
_mig:
  v: 0.1.0
  gen: content
  hash: 26b91f23f68a308d
title: Appointments
description: ""
canonical: /appointments/
pageSections:
  - _component: page-sections/artisan/page-banner
    id: ""
    eyebrow: ""
    heading: Appointments
    backgroundColor: "#321c0e"
    headingColor: "#ffffff"
    eyebrowColor: "var(--color-brand-secondary)"
    backgroundImage: /wp-content/uploads/2020/08/brown-wood-texture-and-backgroun-1-1.jpg
    overlayColor: rgba(50, 28, 14, 0.55)
    align: center
    minHeight: ""
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Appointment Request Form
    text: "

      \t\t\t\t<div class=\"elementor-widget-container\">

      \t\t\t\t\t

      \    <div class=\"tnt-form form-request-appointment-appointments-page\">


      \        <form action=\"/wp-admin/admin-post.php\" class=\"recaptcha-form\" method=\"post\" data-no-elementor-submit=\"\">


      \            <!-- Form Validator -->

      \            <input type=\"hidden\" name=\"action\" value=\"artisan_dental_form_validator\">


      \            <!-- Patient Type -->

      \            <div class=\"form-row checkboxes\">

      \                <label class=\"radio-inline\">

      \                    <input type=\"radio\" name=\"patient_type\" value=\"New Patient\" required=\"\"> New Patient

      \                </label>

      \                <label class=\"radio-inline\">

      \                    <input type=\"radio\" name=\"patient_type\" value=\"Existing Patient\" required=\"\"> Existing Patient

      \                </label>

      \            </div>


      \            <!-- Name -->

      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <input type=\"text\" class=\"first_name\" name=\"first_name\" placeholder=\"First Name\" required=\"\">

      \                </div>

      \                <div class=\"column\">

      \                    <input type=\"text\" class=\"last_name\" name=\"last_name\" placeholder=\"Last Name\" required=\"\">

      \                </div>

      \                <!-- Full Name: Combines first_name & last_name -->

      \                <input type=\"hidden\" name=\"name\">

      \            </div>


      \            <!-- Email -->

      \            <div class=\"form-row full\">

      \                <input type=\"email\" name=\"email\" placeholder=\"Email Address\" required=\"\">

      \            </div>


      \            <!-- Phone / DOB -->

      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <input type=\"tel\" name=\"phone\" placeholder=\"Phone\" required=\"\">

      \                </div>

      \                <div class=\"column\">

      \                    <input type=\"date\" name=\"date_of_birth\" class=\"date-input all-dates date-empty\" autocomplete=\"bday\" data-placeholder=\"DOB: mm/dd/yyyy\" required=\"\">

      \                </div>

      \            </div>


      \            <!-- Insurance -->

      \            <div class=\"form-row full\">

      \                <input type=\"text\" name=\"insurance_provider\" placeholder=\"Insurance Provider\" required=\"\">

      \            </div>


      \            <!-- How did you hear about us? -->

      \            <div class=\"form-row full\">

      \                <input type=\"text\" name=\"how_you_heard_about_us\" placeholder=\"How did you hear about us?\" required=\"\">

      \            </div>


      \            <!-- Requested Date & Time -->

      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <input type=\"date\" name=\"appointment_date\" class=\"date-input restricted-date date-empty\" autocomplete=\"off\" data-placeholder=\"Appointment Date: mm/dd/yyyy\" required=\"\" min=\"2026-08-16\">

      \                </div>

      \                <div class=\"column\">

      \                    <select name=\"requested_time\" class=\"time-input\" required=\"\"><option value=\"\">Requested Time (Choose \"Appointment Date\" first)</option></select>

      \                </div>

      \            </div>


      \            <!-- Message -->

      \            <div class=\"form-row full\">

      \                <textarea name=\"message\" placeholder=\"Notes / Comments\" required=\"\"></textarea>

      \            </div>


      \            <!-- Submit -->

      \            <div class=\"form-row full\">

      \                <button type=\"submit\" class=\"btn\">Submit</button>

      \                <input type=\"hidden\" name=\"token_generate\" id=\"token_generate\">

      \            </div>


      \            <input name=\"_subject\" type=\"hidden\" value=\"Appointment Request Form - Appointments Page\">


      \            <input type=\"hidden\" name=\"page_url\" value=\"/appointments/\">


      \            <input name=\"_redirect\" type=\"hidden\" value=\"/thank-you\">


      \        </form>


      \    </div>


      \    \t\t\t\t</div>

      \t\t\t\t"
    image: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    backgroundImage: ""
    eyebrowColor: "var(--color-brand-secondary)"
    headingColor: "#321c0e"
    textColor: "#333333"
    buttonBackgroundColor: ""
    buttonTextColor: ""
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Office Hours
    text: "

      \t\t\t\t<div class=\"elementor-widget-container\">

      \t\t\t\t\t\t\t\t\t<table class=\"hours\"><tbody><tr class=\"day odd\"><th>Sun</th><td>Closed</td><td colspan=\"2\">&nbsp;</td><td>&nbsp;</td></tr><tr class=\"day even\"><th>Mon</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Tue</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day even\"><th>Wed</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Thur</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day even\"><th>Fri</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Sat</th><td>Closed</td><td>&nbsp;</td></tr></tbody></table>\t\t\t\t\t\t\t\t</div>

      \t\t\t\t"
    image: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    backgroundImage: ""
    eyebrowColor: "var(--color-brand-secondary)"
    headingColor: "#321c0e"
    textColor: "#333333"
    buttonBackgroundColor: ""
    buttonTextColor: ""
  - _component: page-sections/artisan/contact-block
    id: ""
    heading: Additional Information
    details: []
    formBlocks: []
    formAction: /thank-you/
    mapEmbedUrl: https://maps.google.com/maps?q=10%20North%20Livingston%20Street%2C%20Suite%20301%2C%20Madison%2C%20WI%2053703&t=m&z=13&output=embed&iwloc=near
    mapHeight: 380px
    backgroundColor: "#ffffff"
    headingColor: "#321c0e"
    labelColor: "#321c0e"
    textColor: "#333333"
  - _component: page-sections/artisan/logo-strip
    id: ""
    eyebrow: ""
    heading: ""
    logos:
      - image: /wp-content/uploads/2021/04/IB_award.png
        alt: IB small Business award
        link: ""
      - image: /wp-content/uploads/2021/05/2021-communitas-award-nw.png
        alt: 2021 communitas award
        link: ""
      - image: /wp-content/uploads/2020/08/bptw2.png
        alt: bptw2
        link: ""
      - image: /wp-content/uploads/2021/05/BFTW-2018-19-rev.png
        alt: Best for The World 2018-2019
        link: ""
      - image: /wp-content/uploads/2021/04/DCOECC_Climate-Champion_vert.png
        alt: Climate Champion logo
        link: ""
      - image: /wp-content/uploads/2026/06/doctor-nicole-anderson-dds-selected-top-dentists-2011-through-2026.png
        alt: Doctor Nicole Anderson DDS selected Top Dentists from 2011 through 2026.
        link: ""
      - image: /wp-content/uploads/2020/08/cb1-123.png
        alt: cb1 (1)23
        link: ""
      - image: /wp-content/uploads/2021/05/FFPC-winner-logo2-1-rev.png
        alt: FFPC winner logo
        link: ""
      - image: /wp-content/uploads/2025/11/geat-1.png
        alt: geat
        link: ""
    perView: 5
    autoplaySeconds: 5
    backgroundColor: "#321c0e"
    backgroundImage: /wp-content/uploads/2021/05/brown-wood-texture-and-backgroun-nw.jpg
    overlayOpacity: 0.15
    eyebrowColor: "#ffffff"
    headingColor: "#ffffff"
---
