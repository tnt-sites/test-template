$(function () {
    function fixHoursLabels() {
        $('.hours label').each(function () {
            $(this).replaceWith($('<span class="hours-day"></span>').text($(this).text()));
        });
    }

    function fixMobileNavA11y() {
        $('.mean-expand').each(function () {
            var $li = $(this).closest('li');
            var name = $li.children('a').first().not('.mean-expand').text().trim();
            $(this).attr('aria-label', name ? 'Expand ' + name + ' submenu' : 'Expand submenu');
        });
        $('.meanmenu-reveal').each(function () {
            $(this).attr('aria-label', $(this).hasClass('meanclose') ? 'Close menu' : 'Open menu');
        });
    }

    function patchRecaptchaHiddenFields() {
        document.querySelectorAll('.g-recaptcha-response, textarea[name="g-recaptcha-response"]').forEach(function (el) {
            el.setAttribute('aria-hidden', 'true');
            el.setAttribute('tabindex', '-1');
            el.setAttribute('aria-label', 'reCAPTCHA response');
        });
    }

    $('header nav').meanmenu({
        meanMenuContainer: 'header .place-nav',
        meanMenuOpen: "<i class='icon-menu'></i>",
        meanMenuClose: "<i class='icon-plus'></i>",
        meanScreenWidth: 1024,
        meanDisplay: "block"
    });

    fixHoursLabels();
    setTimeout(function () { fixMobileNavA11y(); patchRecaptchaHiddenFields(); }, 0);
    $(document).on('click', '.meanmenu-reveal', function () { setTimeout(fixMobileNavA11y, 0); });
    new MutationObserver(function () { patchRecaptchaHiddenFields(); }).observe(document.body, { childList: true, subtree: true });

    // this will get the full URL at the address bar
    var url = window.location.href;
    // passes on every "a" tag 
    $("#main-nav a").each(function () {
        // checks if its the same on the address bar
        if (url == (this.href)) {
            $(this).closest("li").addClass("active").attr("aria-current", "Page");
        }
    });

    $("nav a[href^='https']").attr({
        target: "_blank",
        rel: "noopener noreferrer"
    });
    $("a[name]").parent().addClass('has_target');
    $("#page h1, h2#append").appendTo("#page-title");
    $("#page .page-divider").parent("#page").addClass('has_divider');
    $(".internal .more-to-explore").appendTo(".internal");

    $("#main-link").click(function () {
        $('main').focus();
    });
    $("#nav-link").click(function () {
        $('#main-nav').focus();
    });
    $("#bn-play").click(function () {
        $('#bn-vid').focus();
    });
    $("#popup").click(function () {
        $('.modal-content').focus();
    });

    ///////////// global variables
    var theWindow = $(window),
        body = $("body"),
        header = $("header"),
        headerBottom = $("header").outerHeight(),
        stickyBottom = $("header #hd-top").outerHeight();

    /////////////// resize options
    $(window).on('resize', function () {
        $("body").css('padding-top', $("header").outerHeight());
        $(".mean-container .mean-nav").css('bottom', $("#fixed-tabs").outerHeight());
        if ($(window).width() <= 1024) {
            $("footer").css('padding-bottom', $("#fixed-tabs").outerHeight());
            $("body").css('padding-top', 0);
        }
        setTimeout(function () { fixHoursLabels(); fixMobileNavA11y(); }, 100);
    }).trigger('resize');

    /////////////// fixed header with animated in on desktop and attach on mobile
    theWindow.on("scroll", function () {
        if (theWindow.width() > 1024) {
            if (theWindow.scrollTop() >= headerBottom) {
                body.addClass("fix-nav");
                header.addClass("animated slideInDown");
            } else if (theWindow.scrollTop() <= headerBottom) {
                body.removeClass("fix-nav");
                header.removeClass("animated slideInDown");
            }
        }
    });

    var url = window.location.href;
    // passes on every "a" tag 
    $("header nav a").each(function () {
        // checks if its the same on the address bar
        if (url == (this.href)) {
            $(this).closest("li").addClass("active").attr("aria-current", "Page");
        }
    });
    $('nav ul li').each(function () {
        if ($(this).find('ul').length) {
            ($(this).addClass('has-submenu').attr('aria-haspopup', 'true'))
        }
    });

    if (theWindow.width() > 1024) {
        $('nav > ul > .has-submenu > a').append("<button aria-label='Toggle submenu'><i class='icon-angle-down' aria-hidden='true'></i></button>")
        $('nav ul ul > .has-submenu > a').append("<button aria-label='Toggle submenu'><i class='icon-angle-right' aria-hidden='true'></i></button>")
    }
    // Nav: drop redundant parent links that duplicate the first submenu item
    $('nav li.has-submenu').each(function() {
        var $li = $(this);
        var $parentLink = $li.children('a').first();
        var $firstChildLink = $li.children('ul').children('li').first().children('a').first();
        if (!$parentLink.length || !$firstChildLink.length) return;
        if ($parentLink.attr('href') === $firstChildLink.attr('href')) {
            var $toggle = $parentLink.find('button').detach();
            var label = $parentLink.clone().children('button').remove().end().text().trim();
            var $span = $('<span class="nav-parent"></span>').text(label);
            if ($toggle.length) $span.append($toggle);
            $parentLink.replaceWith($span);
        }
    });

    // Nav: logo and Home link both point to the homepage
    var logoHref = $('header .logo').attr('href');
    $('#main-nav > ul > li:first-child > a').each(function() {
        var homeHref = $(this).attr('href');
        if (homeHref === logoHref || (homeHref === '/' && logoHref === 'index.html') || (homeHref === 'index.html' && logoHref === '/')) {
            $(this).closest('li').remove();
        }
    });


    if ($(window).width() <= 1024) {
        var didScroll, lastScrollTop = 0,
        delta = 5,
        navbarHeight = $("header").outerHeight();
    
        function hasScrolled() {
            var l = $(this).scrollTop();
            Math.abs(lastScrollTop - l) <= delta || (l > lastScrollTop && l > navbarHeight ? $("header").removeClass("nav-down").addClass("nav-up") : l + $(window).height() < $(document).height() && $("header").removeClass("nav-up").addClass("nav-down"), lastScrollTop = l);

            // Check if the user has scrolled to the top of the page
            if (l == 0) {
                $("header").removeClass();
            }
        }
    
        $(window).scroll(function (l) {
            didScroll = !0
        });
    
        setInterval(function () {
            didScroll && (hasScrolled(), didScroll = !1)
        }, 250);

        fixHoursLabels();
        $("footer .social").clone().prependTo(".mean-container .mean-nav");
        $("footer .hours").clone().appendTo(".mean-container .mean-nav");
        fixHoursLabels();
        fixMobileNavA11y();
    }
    // Image Compare
    const options = {

        // UI Theme Defaults
        
        controlColor: "#FFFFFF",
        controlShadow: true,
        addCircle: false,
        addCircleBlur: true,
        
        // Label Defaults
        
        showLabels: true,
        labelOptions: {
        before: 'Before',
        after: 'After',
        onHover: false
        },
        
        // Smoothing
        
        smoothing: true,
        smoothingAmount: 100,
        
        // Other options
        
        hoverStart: false,
        verticalMode: false,
        startingPoint: 50,
        fluidMode: false
    };
            
        
    const viewers = document.querySelectorAll(".image-compare");
    viewers.forEach((element) => {
        let view = new ImageCompare(element, options).mount();
    });

    //Open and Close Modal
    $('a[class*=modal]').on('click', function (e) {
        e.preventDefault()
        const href = $(this).attr('href')
        const modalElement = document.querySelector(`dialog${href}`)
        this.open ? this.parentElement.close() : (modalElement).showModal()

        //// Clicking popup moves keyboard focus into modal 
        let trimmed = href.substring(1);
        // console.log(trimmed)
        document.getElementById(trimmed).focus();
    });
    
    $('.modal-close').on('click', function (e) {
        this.parentElement.open ? this.parentElement.close() : (modalElement).showModal();
    });

    // Close modal when clicking outside
    $('dialog').on('click', function(e) {
        if (e.target === this) {
            this.close();
        }
    });

    $('[href="#offer-modal"]').on('click', function(){
        let title = $(this).data('title');
        let price = $(this).data('price');
        $('#offer-modal .title').text(title);
        $('#offer-modal .description').text(price);
        $('#offer-modal input[name="_subject"]').val(title);
    });

    $('[href="#emergency-modal"]').on('click', function(){
        let title = $(this).find('h3').text();
        let content = $(this).find('.content').html();
        $('#emergency-modal h3').text(title);
        $('#emergency-modal article').html(content);
    });

    $('[href="#video-modal"]').on('click', function(){
        let player = $(this).data('video-player');
        let embed = $(this).data('video-embed');
        let thumbnail = $(this).data('video-thumbnail');
        $('#video-modal').attr('data-player', player);
        $('#video-modal figure').attr('data-embed', embed);
        $('#video-modal img').attr('src', thumbnail);
        $("#video-modal[data-player]").tntvideos({
            playButton: '.yt-play',
            closeButton: '.close',
            animate: true,
            mobileWidth: 1000
        });
    });

    // In Firefox and Safari plays modal popup videos automatically
    $("#openVid").on("click", function () {
        $("#bio-modal .youtube:not('.active')").trigger("click");
    });
    // Closing popup modal turns off video
    $(".modal-close").on("click", function () {
        for (var i = 0; i < $('.modal-content iframe').length; i++) {
            var video = $('.modal-content iframe').attr("src");
            var video = video.replace("autoplay=1", "autoplay=0");
            $('.modal-content iframe').attr("src", "");
            $('.modal-content iframe').attr("src", video);
        }
    });

    if (theWindow.width() > 1024) {
        var menuItemsBut = document.querySelectorAll('li.has-submenu');
        Array.prototype.forEach.call(menuItemsBut, function (el, i) {
            var btn = el.querySelector('button');
            if (!btn) return;
            btn.addEventListener("click", function (event) {
                if (this.parentNode.parentNode.className == "has-submenu") {
                    this.parentNode.parentNode.className = "has-submenu open";
                    this.setAttribute('aria-expanded', "true");
                } else {
                    this.parentNode.parentNode.className = "has-submenu";
                    this.setAttribute('aria-expanded', "false");
                    this.parentNode.parentNode.className = "has-submenu";
                }
                event.preventDefault();
                return false;
            });
        });
    }

}); // end of top function


$(function () {
    var theWindow = $(window);

    $(".why ul li").wrapInner("<span></span>");

    if ($(".why").length) {
        $("body").addClass("has-why");
    }

    // Wrap .why inner html in .container if not already wrapped
    if ($('.why').length) {
        $('.why').wrapInner('<div class="container"></div>');
    }

    // Wrap .more-to-explore inner html in .content if not already wrapped
    if ($('.more-to-explore').length) {
        $('.more-to-explore').wrapInner('<div class="content"></div>');
    }
    
    if ($('#static-banner').length) {
        $("#static-banner").each(function () {
            var staticBn = $(this).find("img").attr("src");
            if ($(window).width() <= 1024) {
                if('#interior-banner')
                var imgUrl = '<img id="main-img" src="' + selectBG + '" alt="">';
                $('#interior-banner .contain').append(imgUrl);
            } else {
                $('#interior-banner').css({
                    'background-image': 'url(' + staticBn + ')',
                    'background-size': 'cover',
                    'background-repeat': 'no-repeat',
                    'background-position': 'center center'
                })
            }
        })
    }


    ////////////////////////////// FAQ / Accordion
    $(".accordion > h3, .accordion > h2").each(function () {
        $(this).wrap('<button></button>').parent().addClass('toggle');
    });
    $(".toggle").each(function () {
        $(this).nextUntil('.toggle').add().wrapAll('<div>');
        $(this).nextUntil('.toggle').addBack().wrapAll('<div class="toggle-wrapper">');
    });
    $(".toggle").on("click", function () {
        if ($(this).hasClass("active")) {
            $(this).removeClass("active").next().slideUp();
        } else {
            $(".toggle").removeClass("active").next().slideUp();
            $(this).addClass("active").next().slideDown();
        }
        for (var i = 0; i < $('.accordion iframe').length; i++) {
            var video = $('.accordion iframe').attr("src");
            var video = video.replace("autoplay=1", "autoplay=0");
            $('.accordion iframe').attr("src", "");
            $('.accordion iframe').attr("src", video);
        }
    });


    ////////////////////////////// page divider
    var dividerStart = "> h2, .page-divider .wrap",
        mobileWidth = 1025;
    $.when(setupServices()).done(function () {});

    function setupServices() {
        $(".page-divider " + dividerStart)
            .addClass("dividerLead").each(function () { //auto wrap
                $(this)
                    .nextUntil('.dividerLead')
                    .addBack()
                    .wrapAll('<div class="block">');
            });

        $(".block.no_img .dividerLead").each(function () { //auto wrap
            $(this).nextUntil('.block').addBack().wrapAll('<article>');
        });
        $(".block:not(.no_img)").each(function (index) {
            $(this)
                .find('.dividerLead')
                .next(".elem")
                .addClass('wow fadeIn')
                .addClass(index % 2 ? 'elem-right' : 'elem-left')
            // move .elem above H2
            if ($(window).width() >= mobileWidth) {
                $(this).children(".elem").insertBefore($(this).children(".dividerLead"));
            }
        })

        ///////////// move anchors to top of blocks
        $(".page-divider .block a[name]:first-of-type").each(function () {
            var getAnchor = $(this).parent(".has_target"),
                anchorTarget = $(this).parentsUntil(".page-divider").next().find(".dividerLead").parent();
            getAnchor.remove();
            $(this).prependTo(anchorTarget);
        });
    }

    $(".block [class^='btn']").parent("p").addClass('has_btn');

    /////////  mini-blocks for h3 inside divider blocks

    $('.block').each(function () {
        if (!$(this).find('.accordion').length) {
            $(".block > h3").each(function () {
                $(this).nextUntil('h3, .dividerLead').addBack().wrapAll('<div>')
                    .parent().addClass("mini-block")
            });
        }
    });

    $(".mini-block").each(function (index) {
        if ($(this).closest('.block').find('.elem.elem-right').length) {
            $(this)
                .find('h3')
                .next(".elem-sm")
                .addClass(index % 2 ? 'elem-right' : 'elem-left')
        } else if ($(this).closest('.block').find('.elem.elem-left').length) {
            $(this)
                .find('h3')
                .next(".elem-sm")
                .addClass(index % 2 ? 'elem-left' : 'elem-right')
        } else {
            $(this)
                .find('h3')
                .next(".elem-sm")
                .addClass('elem-left')
        }
        if ($(window).width() >= mobileWidth) {
            $(this).children(".elem-sm").insertBefore($(this).children("h3"));
        }
    })

    ///////////// wraps text & .btn in article after .block .elem
    $(".block .elem + *, .block .wrap, .mini-block h3").each(function () { //auto wrap
        $(this).nextUntil('.block, .mini-block').addBack().wrapAll('<article>');
    });

    /// for flexing inside .blocks
    $(".block .elem").each(function () { //auto wrap
        $(this).nextUntil('.block, .mini-block').addBack().wrapAll('<div>').parent().addClass('contain');
    });

    ////////  If no image insided block to change styles
    $('.block').each(function () {
        if (!$(this).find('.elem').length) {
            ($(this).addClass('no_img'))
        }
        var $contain = $(this).find('.contain');
        var $detach = $(this).find('.detach');
        $detach.insertAfter($contain);
    });
    $(".block.no_img .dividerLead").each(function () { //auto wrap
        $(this).nextUntil('.block').addBack().wrapAll('<article>');
    });

    $('.block').each(function () {
        var accordion = $(this).find('.accordion');
        $(this).append(accordion);
        if ( $(this).find('.mini-block').length ) {
            $(this).addClass('has-mini-block');
        } 
        
        if ( $(this).find('.read-more').length ) {
            $(this).addClass('has-read-more');
            $(this).find('.accordion').wrapAll('<div class="read-more-content">');
            $(this).find('.mini-block').wrapAll('<div class="read-more-content">');
        }
        if ( $(this).find('.accordion').length ) {
            $(this).addClass('has-accordion');
        }
    });

    $('.read-more').on('click', function (e) { 
        e.preventDefault();
        var parentBlock = $(this).closest('.block');
        var readMoreContent = parentBlock.find('.read-more-content');
        readMoreContent.slideToggle();
        $(this).toggleClass('less');
        var buttonText = $(this).text();
        $(this).text(buttonText === "Read More" ? "Show Less" : "Read More");
    });

    if (theWindow.width() > 1024) {
        $(".bkg-img").each(function () {
            var bkgImg = $(this).find("figure img").attr("src");
            $(this).css({
                'background-image': 'url(' + bkgImg + ')',
                'background-size': 'cover',
                'background-repeat': 'no-repeat',
                'background-position': 'center center',
                'background-attachment': 'fixed'
            })
        })
    }

    // page title + intro - interior banner
    ////////////  Add flex to .top img/video + text before page-dividers
    $("#page > p:first-of-type").each(function () {
        $(this).nextUntil("div, h1, h2, h3, form").addBack().wrapAll("<article id='intro'>")
    });

    $("#intro").appendTo("#interior-banner .contain")

    ///// Takes main banner image on page and flexes with page title
    $("#main-img").appendTo("#interior-banner .contain")
    $("#main-img").appendTo("#interior-banner")
    $('#interior-banner').each(function () {
        if ($(this).find('#main-img').length) {
            $("#interior-banner #page-title").next('#intro').addBack().wrapAll('<div>')
            $("#interior-banner .contain").next('#main-img').addBack().wrapAll('<div>').parent().addClass('flex-title');
        }
    });

    $(".services-grid img").each(function () {
        $(this).nextUntil('img').addBack().wrapAll('<div>');
        $(this).next().nextUntil('img').addBack().wrapAll('<article>');
        $(this).wrapAll('<figure>');
    });

    //Detect if Interior Banner has image
    if ($('#interior-banner').find('#main-img').length == 0) {
        $('body').addClass('banner-no-img');
    }

    //////// Banner and testimonial video with different top offsets

    var theWindow = $(window);
    $("#banner[data-player]").tntvideos({
        playButton: '.play',
        closeButton: '.close',
        bodyPlaying: null,
        mobileWidth: 1000,
        animate: true,
        closeButtonString: '<button aria-label="close video"><i class="icon-plus"></i> Close Video</button>'
    });

    if (theWindow.width() < 1025) {
        $('#banner .play').appendTo('#banner article')
    }

    $("#testimonials[data-player]").tntvideos({
        playButton: '.play',
        closeButton: '.close',
        animate: true,
        mobileWidth: 1000
    });

    //Basic youtube embed with close button/for internal pages
    $(".elem[data-player]").tntvideos({
        closeButton: '.close',
        playButton: '.yt-play',
        animate: false,
        mobileWidth: 1000,
        offset: 0,
        closeButtonString: '<span><i class="icon-plus"></i></span>'
    });

    $('.video-grid > div iframe').wrap('<div class="videoWrapper"></div>')


    $(".slick-reviews").slick({
        // focusOnChange: true,
        // accessibility: true,
        dots: true,
        arrows: true,
        appendDots: "#reviews .slick-controls",
        appendArrows: "#reviews .slick-controls",
        draggable: false,
        autoplay: true,
        // fade: true,
        cssEase: 'linear',
        autoplaySpeed: 10000,
        slidesToScroll: 1,
        slidesToShow: 1,
        prevArrow: '<button class="arrow" id="prev" aria-label="Previous Slide"><i class="icon-angle-left"></i></button>',
        nextArrow: '<button class="arrow" id="next" aria-label="Next Slide"><i class="icon-angle-right"></i></button>',
        speed: 300,
        customPaging: function (slider, index) {
            return '<button><span></span></button>'
        },
        responsive: [{
            breakpoint: 1000,
            settings: {
                fade: true,
            }
        }]
    });


    //Slider Form
    $(".slick-form").slick({
        dots: true,
        infinite: false,
        draggable: false,
        prevArrow: '',
        nextArrow: '.input .next',
        arrows: true,
        customPaging: function (slider, index) {
            return '<button><span></span></button>'
        },
    });
    //prevent validator on slider form
    $('.slick-form input').on('invalid', function (e) {
        e.preventDefault();
    });


    var $status = $('.gallery .pagingInfo');
    var $gallery = $('.gallery .slick-gallery');
    $gallery.on('init reInit afterChange', function (event, slick, currentSlide, nextSlide) {
        //currentSlide is undefined on init -- set it to 0 in this case (currentSlide is 0 based)
        var i = (currentSlide ? currentSlide : 0) + 1;
        $status.html(`<span> ${i} </span>/<span> ${slick.slideCount} </span> `)
    });


    $('.gallery').each(function () {
        var id = $(this).attr('id');
        $("#" + id + " .slick-gallery").slick({
            dots: true,
            arrows: true,
            fade: true,
            autoplay: true,
            autoplaySpeed: 3000,
            // speed:900,    
            adaptiveHeight: true,
            appendDots: "#" + id + " .slick-controls",
            appendArrows: "#" + id + " .slick-controls",
            prevArrow: '<button class="arrow" id="prev" aria-label="Previous Slide"><i class="icon-angle-left"></i></button>',
            nextArrow: '<button class="arrow" id="next" aria-label="Next Slide"><i class="icon-angle-right"></i></button>',
            customPaging: function (slider, index) {
                return '<button><span></span></button>'
            },
        });
    });



}); /*end of videos & slider function */


//Set Year to All Right Reserved in the Footer
date = document.getElementById("copyDate");
if(date) {
    date.innerHTML = new Date().getFullYear();
}

if( window.location.hash === '#open' ) {
    $('[href="#sp-implant"]').click();
}

$(document).ready(function () {
    if (window.location.hash) {
        var tag = $('a[name=' + window.location.hash.substring(1) + ']')
        $(tag)[0].scrollIntoView();
    }
});

/* cool form */

if (!String.prototype.trim) {
    (function () {
        var rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g;
        String.prototype.trim = function () {
            return this.replace(rtrim, '')
        }
    })()
} [].slice.call(document.querySelectorAll('.input__field')).forEach(function (inputEl) {
    if (inputEl.value.trim() !== '') {
        classie.add(inputEl.parentNode, 'input--filled')
    }

    inputEl.addEventListener('focus', onInputFocus);
    inputEl.addEventListener('blur', onInputBlur)
});

function onInputFocus(ev) {
    classie.add(ev.target.parentNode, 'input--filled')
}

function onInputBlur(ev) {
    if (ev.target.value.trim() === '') {
        classie.remove(ev.target.parentNode, 'input--filled')
    }
}

'use strict';

function classReg(className) {
    return new RegExp("(^|\\s+)" + className + "(\\s+|$)")
}

var hasClass, addClass, removeClass;
if ('classList' in document.documentElement) {
    hasClass = function (elem, c) {
        return elem.classList.contains(c)
    };
    addClass = function (elem, c) {
        elem.classList.add(c)
    };
    removeClass = function (elem, c) {
        elem.classList.remove(c)
    }
} else {
    hasClass = function (elem, c) {
        return classReg(c).test(elem.className)
    };
    addClass = function (elem, c) {
        if (!hasClass(elem, c)) {
            elem.className = elem.className + ' ' + c
        }
    };
    removeClass = function (elem, c) {
        elem.className = elem.className.replace(classReg(c), ' ')
    }
}

function toggleClass(elem, c) {
    var fn = hasClass(elem, c) ? removeClass : addClass;
    fn(elem, c)
}

var classie = {
    hasClass: hasClass,
    addClass: addClass,
    removeClass: removeClass,
    toggleClass: toggleClass,
    has: hasClass,
    add: addClass,
    remove: removeClass,
    toggle: toggleClass
};
if (typeof define === 'function' && define.amd) {
    define(classie)
} else {
    window.classie = classie
}


//Emergency SVG Icons
const toothacheIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="35.149" height="76.797" viewBox="0 0 35.149 76.797"> <g id="_11-most-common-icons-1" data-name="11-most-common-icons-1" transform="translate(-337.123 -477.06)"> <path class="ic-color-2" id="Path_2301" data-name="Path 2301" d="M364.259,530.48c-3.892-1.073-5.822-.21-9.146,1.411a4.238,4.238,0,0,0,1.874.36,1.223,1.223,0,0,1,1.266,1.146,1.208,1.208,0,0,1-1.146,1.266c-2.271.115-4.044-1.032-5.754-2.141-2.251-1.458-4.577-2.967-8.521-2.031-5.153,1.219-5.71,7.659-5.71,10.372,0,11.5,5.7,26.583,11.085,29.347a.362.362,0,0,0,.343.015c.032-.02.055-.04.055-.12v-9.34a4.963,4.963,0,0,1,9.925,0v9.34c0,.08.023.1.055.12a.361.361,0,0,0,.342-.015c5.387-2.764,11.085-17.849,11.085-29.347C370.012,538.219,369.451,531.913,364.259,530.48Z" transform="translate(0 -16.405)" class="ic-color-2" /> <path class="ic-color" id="Path_2302" data-name="Path 2302" d="M362.3,512.491l17.42-21.24-7.773.415,4.132-14.606-14.922,21.328,7.773-.415Z" transform="translate(-7.446)" /> <path class="ic-color" id="Path_2303" data-name="Path 2303" d="M348.127,511.283l4.861,8.422-4.382-16.153-2.542,4-5.788-7.214,5.309,14.945Z" transform="translate(-0.977 -7.214)" /> </g> </svg>';
const chippedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="53.865" viewBox="0 0 48 53.865"> <g data-name="11-most-common-icons-2" transform="translate(678.881 -185.76)"> <path id="Path_2304" data-name="Path 2304" d="M-441.411,216.368l5.047-5.4a.69.69,0,0,0-.034-.973.688.688,0,0,0-.972.033l-5.046,5.4a.689.689,0,0,0-.18.555.693.693,0,0,0,.213.416A.688.688,0,0,0-441.411,216.368Z" transform="translate(-199.066 -20.261)" class="ic-color" /> <path id="Path_2305" data-name="Path 2305" d="M-417.875,263.138a.687.687,0,0,0-.813-.534l-6.8,1.406a.687.687,0,0,0-.543.758c0,.018.005.036.009.054a.687.687,0,0,0,.812.534l6.8-1.406A.688.688,0,0,0-417.875,263.138Z" transform="translate(-213.022 -64.729)" class="ic-color" /> <path id="Path_2306" data-name="Path 2306" d="M-470.481,194.011a.687.687,0,0,0,.774-.588l.941-6.88a.687.687,0,0,0-.588-.775.687.687,0,0,0-.774.588l-.941,6.88a.713.713,0,0,0,0,.179A.687.687,0,0,0-470.481,194.011Z" transform="translate(-175.077 0)" class="ic-color" /> <path id="Path_2307" data-name="Path 2307" d="M-641.312,247.124a8.78,8.78,0,0,1-8.777-8.778,8.814,8.814,0,0,1,.081-1.124,7.361,7.361,0,0,0-1.449.185c-3.358.778-5.388,1.936-7.847,1.936s-4.491-1.159-7.848-1.936c-6.311-1.461-11.729,5.577-11.729,13.079s2.7,9.284,4.141,15.873c.954,4.345.353,8.84,1.172,12.057.7,2.744,2.774,4.558,3.969,4.558,1.53,0,3.3-3.879,5.794-9.04,1.5-3.094,2.124-4.947,4.247-5.04,3.206-.138,3.256,1.946,4.755,5.04,2.5,5.161,4.264,9.04,5.794,9.04,1.194,0,3.27-1.815,3.968-4.558.819-3.217.217-7.711,1.171-12.057,1.447-6.588,4.142-8.362,4.142-15.873a15.992,15.992,0,0,0-.38-3.454A8.791,8.791,0,0,1-641.312,247.124Zm-9.4-4.637c-.234.141-.525.3-.865.475a10.728,10.728,0,0,1-1.182.524,4.232,4.232,0,0,1-.74.21,1.939,1.939,0,0,1-.45.034,2.281,2.281,0,0,1-.46-.081,4.882,4.882,0,0,1-.811-.331c-.256-.125-.507-.249-.761-.363a7.318,7.318,0,0,0-1.6-.531,7.918,7.918,0,0,0-1.732-.146,8.933,8.933,0,0,0-1.749.2,9.028,9.028,0,0,0-1.621.53,12.44,12.44,0,0,1-1.6.634,2.473,2.473,0,0,1-.452.074,1.05,1.05,0,0,1-.112,0h-.11a1.626,1.626,0,0,1-.227-.027,3.654,3.654,0,0,1-.742-.236,9.821,9.821,0,0,1-1.156-.582c-.33-.189-.611-.368-.838-.519-.455-.3-.7-.495-.7-.495l.787.331c.25.1.555.227.9.363s.744.281,1.177.4a3.975,3.975,0,0,0,.654.133,1.264,1.264,0,0,0,.15,0,1.515,1.515,0,0,0,.161-.016,1.941,1.941,0,0,0,.319-.079c.443-.154.928-.444,1.464-.7a8.8,8.8,0,0,1,1.752-.639,8.9,8.9,0,0,1,1.909-.241,8.167,8.167,0,0,1,1.936.186,7.492,7.492,0,0,1,1.766.643c.535.268,1.014.582,1.442.742a1.322,1.322,0,0,0,.618.083,5.394,5.394,0,0,0,.667-.115c.439-.1.839-.231,1.2-.34s.666-.222.924-.308l.806-.28S-650.243,242.211-650.713,242.487Z" transform="translate(0 -43.348)" class="ic-color-2" /> </g> </svg>';
const crackedIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="35.747" height="43.812" viewBox="0 0 35.747 43.812"> <path data-name="11-most-common-icons-3" d="M370.32,178.632a8.525,8.525,0,0,0-6.365-7.152,9.437,9.437,0,0,0-4.535-.158l-5.036,3.987,3.482,5.373-5.654,6,4.533,7.6L346.738,185.5l4.611-5.012-4.779-5.248,3.136-2.262a8.438,8.438,0,0,1-1.275-.525,9.528,9.528,0,0,0-4.612-1.206,11.982,11.982,0,0,0-2.772.346c-5.6,1.326-6.207,8.327-6.207,11.276,0,12.765,6.278,29.206,12.215,31.986a.67.67,0,0,0,.242.072,2.314,2.314,0,0,0,.025-.267v-9.978a5.534,5.534,0,0,1,4.869-5.545,5.4,5.4,0,0,1,5.92,5.37v10.035a.889.889,0,0,0,.061.376,2.446,2.446,0,0,0,.368-.142C365.3,211.314,372.019,190.708,370.32,178.632Z" transform="translate(-334.84 -171.116)" class="ic-color-2" /></svg>';
const sensitiveIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="69" height="68" viewBox="0 0 69 68"> <path class="ic-color" d="M10.27 33.733c0-.302.007-.6.018-.9h-8.5a.9.9 0 1 0 0 1.799h8.5c-.011-.299-.019-.598-.019-.9z" /> <path class="ic-color" d="M17.367 50.87c-.213-.214-.419-.431-.622-.65l-6.01 6.01a.9.9 0 0 0 1.272 1.272l6.01-6.01c-.22-.204-.437-.41-.65-.623z" /> <path class="ic-color" d="M34.504 57.967c-.301 0-.6-.007-.9-.018v8.499a.9.9 0 0 0 1.799 0v-8.5c-.298.012-.598.019-.9.019z" /> <path class="ic-color" d="M17.367 16.596c.213-.213.43-.42.65-.623l-6.01-6.01a.899.899 0 1 0-1.272 1.272l6.01 6.01c.203-.219.41-.436.622-.649z" /> <path class="ic-color" d="M12.114 24.458c.115-.278.237-.552.361-.823l-7.852-3.253a.9.9 0 1 0-.688 1.662l7.852 3.252c.104-.28.212-.56.327-.838z" /> <path class="ic-color" d="M12.114 43.006a23.578 23.578 0 0 1-.327-.837L3.935 45.42a.899.899 0 1 0 .689 1.661l7.852-3.252a23.538 23.538 0 0 1-.362-.824z" /> <path class="ic-color" d="M25.23 56.122a22.432 22.432 0 0 1-.824-.362l-3.252 7.853a.899.899 0 1 0 1.661.688l3.253-7.852c-.28-.104-.56-.212-.838-.327z" /> <path class="ic-color" d="M34.504 49.86c-8.907 0-16.128-7.22-16.128-16.127 0-5.167 2.433-9.763 6.213-12.715v-7.216c-7.316 3.647-12.342 11.201-12.342 19.93 0 12.293 9.965 22.258 22.257 22.258 2.763 0 5.408-.505 7.85-1.426V47.82c-2.324 1.298-5 2.04-7.85 2.04z" /> <path class="ic-color-2" d="M67.22 32.794h-3.59l1.986-2.347a.824.824 0 1 0-1.259-1.065L61.56 32.69a.818.818 0 0 0-.22.105h-2.743l4.183-4.944a.824.824 0 1 0-1.258-1.065l-4.798 5.67a22.167 22.167 0 0 0-5.604-13.53l7.389.616a.824.824 0 0 0 .137-1.643l-6.454-.537 2.16-2.161 4.175.347a.824.824 0 1 0 .137-1.642l-2.785-.232 2.41-2.41a.9.9 0 1 0-1.272-1.272l-2.538 2.538-.255-3.064a.824.824 0 1 0-1.642.137l.36 4.317a.816.816 0 0 0-.083.23l-1.94 1.94-.537-6.454a.824.824 0 0 0-1.643.137l.615 7.383a22.165 22.165 0 0 0-13.608-5.644l5.667-4.796a.824.824 0 0 0-1.065-1.258l-4.944 4.184V6.585l3.198-2.706a.824.824 0 1 0-1.065-1.258l-2.133 1.805V1.018a.9.9 0 0 0-1.798 0v3.589L31.258 2.62a.824.824 0 1 0-1.065 1.258L33.5 6.677c.022.077.059.151.105.22v2.744L28.66 5.457a.824.824 0 1 0-1.065 1.258l5.67 4.798a22.172 22.172 0 0 0-6.612 1.388v6.744a16.048 16.048 0 0 1 7.85-2.04c8.906 0 16.127 7.221 16.127 16.128 0 5.166-2.433 9.762-6.212 12.714v7.216a22.296 22.296 0 0 0 4.889-3.315l-.612 7.35a.824.824 0 0 0 1.643.136l.537-6.454 2.16 2.16-.347 4.175a.824.824 0 0 0 1.643.137l.231-2.785 2.41 2.41a.899.899 0 1 0 1.272-1.271l-2.538-2.538 3.064-.256a.824.824 0 1 0-.137-1.642l-4.316.36a.82.82 0 0 0-.23-.083l-1.94-1.94 6.454-.536a.824.824 0 0 0-.137-1.643l-7.347.612a22.16 22.16 0 0 0 5.607-13.606l4.796 5.667a.825.825 0 0 0 1.258-1.065l-4.183-4.944h3.055l2.706 3.198a.824.824 0 0 0 1.259-1.065l-1.805-2.133h3.408a.899.899 0 1 0 0-1.798z" /> </svg>';
const knockedIcon = '<svg width="74" height="80" viewBox="0 0 74 80" xmlns="http://www.w3.org/2000/svg"> <g transform="translate(-899.87 -150.29)" data-name="11-most-common-icons-5"> <path class="ic-color" transform="translate(-189.01)" d="m1125.2 160.45a1.76 1.76 0 0 1 -1.76 -1.758v-5.642a1.76 1.76 0 0 1 3.52 0v5.642a1.76 1.76 0 0 1 -1.76 1.758z" stroke="#f4efed" stroke-width="2" data-name="Path 2308" /> <path class="ic-color" transform="translate(-189.01 -350.9)" d="m1125.2 573.62a1.76 1.76 0 0 1 -1.76 -1.758v-5.64a1.76 1.76 0 0 1 3.52 0v5.64a1.76 1.76 0 0 1 -1.76 1.758z" stroke="#f4efed" stroke-width="2" data-name="Path 2309" /> <path class="ic-color" transform="translate(-350.89 -193.67)" d="m1321.4 382.85h-5.642a1.758 1.758 0 1 1 0 -3.517h5.642a1.758 1.758 0 0 1 0 3.517z" stroke="#f4efed" stroke-width="2" data-name="Path 2310" /> <path class="ic-color" transform="translate(0 -193.67)" d="m908.27 382.85h-5.642a1.758 1.758 0 1 1 0 -3.517h5.642a1.758 1.758 0 0 1 0 3.517z" stroke="#f4efed" stroke-width="2" data-name="Path 2311" /> <path class="ic-color" transform="translate(-268.31 -24.981)" d="m1218.5 189.13a1.759 1.759 0 0 1 -1.527 -2.63l2.794-4.9a1.759 1.759 0 1 1 3.057 1.741l-2.8 4.9a1.756 1.756 0 0 1 -1.524 0.889z" stroke="#f4efed" stroke-width="2" data-name="Path 2312" /> <path class="ic-color" transform="translate(-94.618 -329.87)" d="m1014 548.12a1.76 1.76 0 0 1 -1.527 -2.631l2.794-4.9a1.759 1.759 0 1 1 3.056 1.743l-2.794 4.9a1.757 1.757 0 0 1 -1.529 0.888z" stroke="#f4efed" stroke-width="2" data-name="Path 2313" /> <path class="ic-color" transform="translate(-328.83 -273.4)" d="M1294.714,479.514a1.748,1.748,0,0,1-.868-.232l-4.9-2.792a1.759,1.759,0,1,1,1.741-3.056l4.9,2.792a1.76,1.76,0,0,1-.873,3.288Z" stroke="#f4efed" stroke-width="2" data-name="Path 2314" /> <path class="ic-color" transform="translate(-23.955 -99.721)" d="M935.733,275.016a1.744,1.744,0,0,1-.867-.232l-4.9-2.792a1.759,1.759,0,1,1,1.741-3.056l4.9,2.792a1.76,1.76,0,0,1-.873,3.288Z" stroke="#f4efed" stroke-width="2" data-name="Path 2315" /> <path class="ic-color" transform="translate(-326.89 -93.726)" d="m1287.5 268.04a1.759 1.759 0 0 1 -0.9 -3.272l4.856-2.879a1.759 1.759 0 0 1 1.795 3.026l-4.856 2.878a1.742 1.742 0 0 1 -0.895 0.247z" stroke="#f4efed" stroke-width="2" data-name="Path 2316" /> <path class="ic-color" transform="translate(-25.073 -272.69)" d="m932.15 478.76a1.76 1.76 0 0 1 -0.9 -3.273l4.856-2.876a1.759 1.759 0 0 1 1.794 3.025l-4.856 2.876a1.752 1.752 0 0 1 -0.894 0.248z" stroke="#f4efed" stroke-width="2" data-name="Path 2317" /> <path class="ic-color" transform="translate(-270.23 -331.75)" d="M1223.687,550.284a1.756,1.756,0,0,1-1.514-.863l-2.876-4.85a1.759,1.759,0,1,1,3.026-1.795l2.876,4.851a1.76,1.76,0,0,1-1.512,2.657Z" stroke="#f4efed" stroke-width="2" data-name="Path 2318" /> <path class="ic-color" transform="translate(-91.273 -29.934)" d="m1013 194.9a1.758 1.758 0 0 1 -1.515 -0.863l-2.876-4.851a1.759 1.759 0 1 1 3.026 -1.794l2.876 4.85a1.761 1.761 0 0 1 -1.511 2.658z" stroke="#f4efed" stroke-width="2" data-name="Path 2319" /> <path transform="translate(-96.333 -88.102)" d="M1051.527,264.432l-.005-.262v-.025a8.3,8.3,0,0,0-3.695-7.077,14.054,14.054,0,0,0-7.752-2.041h-.084a18.546,18.546,0,0,0-5.848.934,26.916,26.916,0,0,1,4.039,3.294,1.121,1.121,0,0,1-1.614,1.557c-.054-.053-4.792-4.858-10.048-5.721l-2.639.035a.768.768,0,0,0-.112.008,12.922,12.922,0,0,0-5.775,1.944,8.3,8.3,0,0,0-3.688,7.093l-.01.713a14.692,14.692,0,0,0,2.224,8.388l.194.349a16.867,16.867,0,0,1,2.52,9.554c-.008,6.691,1.235,10.18,2.278,11.934,1.15,1.909,1.807,2.685,3.687,2.685a3.057,3.057,0,0,0,2.914-3.006c.079-.791.094-1.7.107-2.669a28.572,28.572,0,0,1,.936-7.889,13.652,13.652,0,0,1,1.517-3.6,3.141,3.141,0,0,1,2.459-1.392,2.443,2.443,0,0,1,2.007,1.363,15.426,15.426,0,0,1,1.55,3.683,24.685,24.685,0,0,1,.969,8.729,4.885,4.885,0,0,0,.949,3.846,2.818,2.818,0,0,0,2.026.932c1.782,0,2.545-.792,3.685-2.691,1.041-1.745,2.283-5.232,2.278-11.933a16.88,16.88,0,0,1,2.535-9.569l.173-.313a14.805,14.805,0,0,0,2.23-8.414c0-.143,0-.288-.008-.44" class="ic-color-2" data-name="Path 2320" /> </g> </svg>';
const lostIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="41.247" height="57.386" viewBox="0 0 41.247 57.386"> <g data-name="11-most-common-icons-6" transform="translate(-994.305 -1638.483)"> <path id="Path_2321" data-name="Path 2321" d="M1105.552,1749.443c0,2.724,3.081,4.939,6.866,4.939s6.867-2.215,6.867-4.939v-1.638a19.131,19.131,0,0,0-6.76,1.464l-.127.056-.115-.053a18.576,18.576,0,0,0-6.013-1.422c-.045,0-.093,0-.136,0l-.583.008Z" transform="translate(-97.469 -109.322)" class="ic-color" /> <path id="Path_2322" data-name="Path 2322" d="M1035.543,1758.618a.245.245,0,0,0,0-.037,9.329,9.329,0,0,0-4.145-7.946,14.527,14.527,0,0,0-6.69-2.18v1.557c0,4.319-4.377,7.831-9.758,7.831s-9.756-3.512-9.756-7.831v-1.548l-.175,0a1.3,1.3,0,0,0-.143.01,14.344,14.344,0,0,0-6.422,2.175,9.3,9.3,0,0,0-4.139,7.947c-.006.287-.008.548-.008.8a16.332,16.332,0,0,0,2.463,9.321l.214.384a18.355,18.355,0,0,1,2.727,10.389c0,7.4,1.372,11.263,2.53,13.211,1.281,2.126,2.067,3.058,4.229,3.058a3.571,3.571,0,0,0,3.409-3.5c.086-.879.1-1.891.12-2.959a31.263,31.263,0,0,1,1.013-8.592,14.719,14.719,0,0,1,1.642-3.9,3.254,3.254,0,0,1,2.478-1.432h.03a2.474,2.474,0,0,1,2.022,1.4,16.54,16.54,0,0,1,1.678,3.991,27.026,27.026,0,0,1,1.058,9.511,5.567,5.567,0,0,0,1.093,4.389,3.288,3.288,0,0,0,2.374,1.092h0c2.047,0,2.958-.944,4.226-3.064,1.156-1.939,2.534-5.8,2.531-13.215a18.427,18.427,0,0,1,2.748-10.4l.188-.338a16.44,16.44,0,0,0,2.472-9.353Z" transform="translate(0 -99.891)" class="ic-color-2" /> </g> </svg>';
const brokenIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="78.832" height="32.878" viewBox="0 0 78.832 32.878"> <g data-name="11-most-common-icons-7" transform="translate(-675.411 -294.434)"> <path id="Path_2362" data-name="Path 2362" d="M712.709,304.41l6.933-9.909c-1.012-.026-2.038-.047-3.1-.056-.569,0-1.135-.011-1.718-.011s-1.149.006-1.718.011c-26.081.228-37.7,5.587-37.7,7.653v8.44a2.528,2.528,0,0,1,1.256-.343,4.468,4.468,0,0,1,2.7.919,3.465,3.465,0,0,1,3.121-1.98,7.4,7.4,0,0,1,5.594,2.574,4.519,4.519,0,0,1,4.152-2.746,9.031,9.031,0,0,1,7.37,3.821,6.685,6.685,0,0,1,6.185-4.168,10.178,10.178,0,0,1,9.038,5.521c.008-.014.017-.027.025-.04l4.586-10.046Z" class="ic-color-2" /> <path id="Path_2363" data-name="Path 2363" d="M723.359,294.625l-1.122,3.967,6.728-.359-9.384,11.442a10.062,10.062,0,0,1,4.47-1.059,6.686,6.686,0,0,1,6.185,4.168,9.031,9.031,0,0,1,7.371-3.821,4.519,4.519,0,0,1,4.151,2.746,7.482,7.482,0,0,1,.806-.8,7.355,7.355,0,0,1,4.789-1.77,3.465,3.465,0,0,1,3.121,1.98,4.465,4.465,0,0,1,2.7-.919,2.526,2.526,0,0,1,1.258.344V302.1C754.43,300.217,744.786,295.6,723.359,294.625Z" transform="translate(-0.187 -0.001)" class="ic-color-2" /> <path id="Path_2364" data-name="Path 2364" d="M713.847,317.919a8.017,8.017,0,0,0-7.948-7.067,4.516,4.516,0,0,0-4.511,4.512v9.5a2.523,2.523,0,0,0,2.519,2.52h8.623a1.36,1.36,0,0,0,1.3-1.022A3.46,3.46,0,0,1,713.8,326V318.86C713.8,318.542,713.818,318.23,713.847,317.919Z" transform="translate(-0.11 -0.07)" class="ic-color-2" /> <path id="Path_2365" data-name="Path 2365" d="M692.3,311.2a2.349,2.349,0,0,0-2.346,2.345v9.495a2.182,2.182,0,0,0,2.18,2.18h4.908a2.137,2.137,0,0,0,2.134-2.134v-5.009A6.884,6.884,0,0,0,692.3,311.2Z" transform="translate(-0.062 -0.071)" class="ic-color-2" /> <path id="Path_2366" data-name="Path 2366" d="M685.347,312.222a5.182,5.182,0,0,0-2.835-.848,1.307,1.307,0,0,0-1.3,1.305v9.744a1.4,1.4,0,0,0,1.4,1.4h3.754a1.374,1.374,0,0,0,1.372-1.373V316.6A5.214,5.214,0,0,0,685.347,312.222Z" transform="translate(-0.025 -0.072)" class="ic-color-2" /> <path id="Path_2367" data-name="Path 2367" d="M676.67,312.439a.394.394,0,0,0-.393.393v7.72a.838.838,0,0,0,.839.837h1.6a.3.3,0,0,0,.3-.3v-6.3A2.347,2.347,0,0,0,676.67,312.439Z" transform="translate(-0.004 -0.076)" class="ic-color-2" /> <path id="Path_2368" data-name="Path 2368" d="M724.036,310.852a8.055,8.055,0,0,0-8.008,8.008V326a1.332,1.332,0,0,0,.073.356,1.358,1.358,0,0,0,1.3,1.021h8.623a2.523,2.523,0,0,0,2.519-2.52v-9.5A4.517,4.517,0,0,0,724.036,310.852Z" transform="translate(-0.172 -0.07)" class="ic-color-2" /> <path id="Path_2369" data-name="Path 2369" d="M737.654,311.2a6.884,6.884,0,0,0-6.877,6.877v5.009a2.137,2.137,0,0,0,2.134,2.134h4.908a2.182,2.182,0,0,0,2.18-2.18v-9.495A2.348,2.348,0,0,0,737.654,311.2Z" transform="translate(-0.234 -0.071)" class="ic-color-2" /> <path id="Path_2370" data-name="Path 2370" d="M747.448,311.374a5.252,5.252,0,0,0-5.225,5.225v5.854a1.374,1.374,0,0,0,1.373,1.373h3.753a1.4,1.4,0,0,0,1.4-1.4v-9.744A1.307,1.307,0,0,0,747.448,311.374Z" transform="translate(-0.283 -0.072)" class="ic-color-2" /> <path id="Path_2371" data-name="Path 2371" d="M753.305,312.439a2.347,2.347,0,0,0-2.343,2.345v6.3a.3.3,0,0,0,.3.3h1.6a.838.838,0,0,0,.838-.837v-7.72A.394.394,0,0,0,753.305,312.439Z" transform="translate(-0.32 -0.076)" class="ic-color-2" /> </g> </svg>';
const looseIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="57.546" height="51.531" viewBox="0 0 57.546 51.531"> <g transform="translate(-1648.375 -170.556)"> <path id="Path_2333" data-name="Path 2333" d="M1778.728,189.365l.086-.246c0-.008.006-.016.01-.025a8.271,8.271,0,0,0-.985-7.9,13.952,13.952,0,0,0-6.518-4.6l-.077-.03a18.516,18.516,0,0,0-5.782-1.16,27.19,27.19,0,0,1,2.622,4.482,1.118,1.118,0,0,1-2.048.9c-.03-.069-2.776-6.208-7.379-8.84l-2.474-.885a.861.861,0,0,0-.106-.03,12.832,12.832,0,0,0-6.063-.19,8.27,8.27,0,0,0-5.908,5.347l-.258.661a14.692,14.692,0,0,0-.849,8.611l.06.395a16.833,16.833,0,0,1-.978,9.8c-2.337,6.25-2.394,9.939-2.031,11.942.407,2.182.75,3.137,2.5,3.791a3.047,3.047,0,0,0,3.767-1.8c.348-.713.68-1.56,1.03-2.457a28.426,28.426,0,0,1,3.621-7.049,13.708,13.708,0,0,1,2.667-2.833,3.139,3.139,0,0,1,2.778-.446,2.432,2.432,0,0,1,1.4,1.973,15.357,15.357,0,0,1,.166,3.978,24.78,24.78,0,0,1-2.137,8.5,4.867,4.867,0,0,0-.456,3.923,2.788,2.788,0,0,0,1.565,1.574c1.663.62,2.65.145,4.375-1.233,1.579-1.27,3.951-4.1,6.28-10.359a16.867,16.867,0,0,1,5.7-8.062l.27-.23a14.736,14.736,0,0,0,5.009-7.088c.05-.134.1-.271.15-.414" transform="translate(-80.677 0)" class="ic-color-2" /> <path id="Path_2334" data-name="Path 2334" d="M1673.122,428.155a24.97,24.97,0,0,1-7.185-1.085c-9.22-2.776-13.035-11.33-11.282-17.664a1.328,1.328,0,0,1,.086-.23l.9-1.877a3.575,3.575,0,0,0-1.607-.25h-4.279a1.381,1.381,0,0,1,0-2.762h4.279c2.009,0,3.312.5,3.988,1.533a2.679,2.679,0,0,1,.206,2.475l-.942,1.962c-1.327,5.07,1.883,11.889,9.447,14.167,8.312,2.5,16.4.046,19.231-5.846l5.494-11.436a4.6,4.6,0,0,1,3.987-2.854h9.094a1.381,1.381,0,0,1,0,2.762h-9.094c-.895,0-1.463,1.215-1.469,1.227l-5.522,11.5C1685.9,425.1,1679.969,428.155,1673.122,428.155Z" transform="translate(0 -206.067)" class="ic-color" /> </g> </svg>';
const injuryIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="44.16" height="54.521" viewBox="0 0 44.16 54.521"> <g transform="translate(-331.416 -273.528)"> <path id="Path_2335" data-name="Path 2335" d="M337.65,298.37l2.518-4.528a10.849,10.849,0,0,1,9.059-4.9h5.253a.689.689,0,0,0,.534,0h5.253a10.828,10.828,0,0,1,9.022,4.844c.013.02.025.04.037.06l2.533,4.55a.7.7,0,0,0,.565.29h1.365c-.62-4.326-2.272-9.005-5.429-12a2.466,2.466,0,0,0-1.93-.64,4.589,4.589,0,0,0-2.564,1.784.891.891,0,0,1-.729.379.907.907,0,0,1-.212-.025.887.887,0,0,1-.669-.747c-.463-3.591-2.918-3.54-3.2-3.52a1.04,1.04,0,0,1-.1,0,3.191,3.191,0,0,0-3.235,2.7,1.031,1.031,0,0,1-1.945,0,3.2,3.2,0,0,0-3.235-2.7c-.038,0-.074,0-.113,0-.264-.016-2.726-.072-3.189,3.52a.888.888,0,0,1-1.611.392,4.588,4.588,0,0,0-2.563-1.782,2.44,2.44,0,0,0-1.92.635c-3.168,3-4.818,7.678-5.439,12h1.365A.7.7,0,0,0,337.65,298.37Z" transform="translate(-1.251 -3.028)" class="ic-color-2" /> <path id="Path_2336" data-name="Path 2336" d="M350.359,283.759a10.318,10.318,0,0,0-2.551.751,5.863,5.863,0,0,1,1.594.961A5.615,5.615,0,0,1,350.359,283.759Z" transform="translate(-4.781 -2.984)" class="ic-color-2" /> <path id="Path_2337" data-name="Path 2337" d="M376.322,284.509a10.284,10.284,0,0,0-2.552-.747,5.624,5.624,0,0,1,.955,1.709A5.859,5.859,0,0,1,376.322,284.509Z" transform="translate(-12.353 -2.985)" class="ic-color-2" /> <path id="Path_2338" data-name="Path 2338" d="M362.938,318.187a9.212,9.212,0,0,0-5.909,2.08,1.108,1.108,0,0,1-1.422,0,9.207,9.207,0,0,0-5.907-2.08c-4.046,0-8.572,3.538-8.572,8.274a1.1,1.1,0,0,1-.033.257c3.038,4.219,7.925,7.2,15.223,7.2s12.187-2.983,15.225-7.2a1.091,1.091,0,0,1-.033-.256C371.511,321.725,366.984,318.187,362.938,318.187Z" transform="translate(-2.823 -13.026)" class="ic-color" /> <path id="Path_2339" data-name="Path 2339" d="M353.5,328.049c10.073,0,22.081-4.915,22.081-28.328,0-9.251-2.872-20.43-9.29-24.552-3.391-2.18-7.508-2.187-12.236-.025a1.337,1.337,0,0,1-1.109,0,15.957,15.957,0,0,0-6.595-1.615,10.236,10.236,0,0,0-5.64,1.64c-6.418,4.122-9.29,15.3-9.29,24.553C331.416,323.134,343.423,328.049,353.5,328.049Zm-17.4-14.466a26.854,26.854,0,0,1-3.725-13.863c0-6.106,2.073-14.666,7.911-18.694,3.656-2.522,8.1-2.857,13.209-1,5.112-1.861,9.555-1.527,13.21,1,5.839,4.028,7.911,12.588,7.911,18.694a26.852,26.852,0,0,1-3.725,13.863,1.107,1.107,0,0,1-.508.79c-.067.1-.126.205-.194.3-3.711,5.23-9.485,7.995-16.695,7.995s-12.982-2.765-16.693-7.995c-.068-.1-.127-.2-.194-.3A1.107,1.107,0,0,1,336.1,313.583Z" transform="translate(0 0)" class="ic-color-2" /> <path id="Path_2340" data-name="Path 2340" d="M366.064,305.8a6,6,0,0,0-4.689-1.581,1.193,1.193,0,0,0-.883.459,1.131,1.131,0,0,0,.181.928l.576.875a3.916,3.916,0,0,1,.4,3.474,3.578,3.578,0,0,1-2.342,2.239,4.245,4.245,0,0,1-1.373.164c-.042,0-.066,0-.091,0s-.05,0-.074,0a4.371,4.371,0,0,1-1.389-.166,3.578,3.578,0,0,1-2.342-2.239,3.914,3.914,0,0,1,.4-3.474l.576-.875a1.131,1.131,0,0,0,.181-.928,1.193,1.193,0,0,0-.883-.459,6,6,0,0,0-4.689,1.581,10.68,10.68,0,0,0-3.293,7.309,10.559,10.559,0,0,1,4.889-1.23,11.516,11.516,0,0,1,6.619,2.051,11.524,11.524,0,0,1,6.62-2.051,10.559,10.559,0,0,1,4.889,1.23A10.682,10.682,0,0,0,366.064,305.8Z" transform="translate(-4.353 -8.938)" class="ic-color-2" /> </g> </svg>';
const painIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="64.15" height="46.706" viewBox="0 0 64.15 46.706"> <g data-name="11-most-common-icons-10" transform="translate(-675.411 -293.871)"> <path id="Path_2341" data-name="Path 2341" d="M708.884,294.443c-.463,0-.924-.009-1.4-.009s-.935,0-1.4.009c-21.224.186-30.677,4.547-30.677,6.228v6.868a2.057,2.057,0,0,1,1.022-.279,3.636,3.636,0,0,1,2.2.748,2.82,2.82,0,0,1,2.54-1.611,6.02,6.02,0,0,1,4.552,2.095,3.677,3.677,0,0,1,3.379-2.235,7.349,7.349,0,0,1,6,3.109,5.44,5.44,0,0,1,5.033-3.392,8.283,8.283,0,0,1,7.354,4.492,8.282,8.282,0,0,1,7.354-4.492,5.441,5.441,0,0,1,5.033,3.392,7.349,7.349,0,0,1,6-3.109,3.677,3.677,0,0,1,3.378,2.235,6.084,6.084,0,0,1,.656-.654,5.987,5.987,0,0,1,3.9-1.441,2.82,2.82,0,0,1,2.54,1.611,3.636,3.636,0,0,1,2.2-.748,2.055,2.055,0,0,1,1.023.28v-6.869C739.561,298.99,730.107,294.628,708.884,294.443Z" transform="translate(0 -0.563)" class="ic-color-2" /> <path id="Path_2342" data-name="Path 2342" d="M734.8,334.782a3.634,3.634,0,0,1-1.912-.552v1.362a2.83,2.83,0,0,1-2.826,2.826,5.994,5.994,0,0,1-4.308-1.826v.161a3.314,3.314,0,0,1-3.31,3.31,6.506,6.506,0,0,1-5.016-2.362,5.01,5.01,0,0,1-4.742,3.42,5.333,5.333,0,0,1-4.479-2.448,5.333,5.333,0,0,1-4.479,2.448,5.009,5.009,0,0,1-4.742-3.42,6.507,6.507,0,0,1-5.016,2.362,3.314,3.314,0,0,1-3.31-3.31v-.161a5.994,5.994,0,0,1-4.308,1.826,2.83,2.83,0,0,1-2.826-2.826V334.23a3.634,3.634,0,0,1-1.911.552,2.079,2.079,0,0,1-1.806-1.064L679.2,335v6.82c0,2.594,11.033,6.213,29,6.213s29-3.619,29-6.213V335l-.6-1.277A2.079,2.079,0,0,1,734.8,334.782Z" transform="translate(-0.719 -7.451)" class="ic-color-2" /> <path id="Path_2343" data-name="Path 2343" d="M711.527,316.6a6.524,6.524,0,0,0-6.468-5.751,3.675,3.675,0,0,0-3.671,3.672v7.729a2.053,2.053,0,0,0,2.05,2.051h7.017a1.107,1.107,0,0,0,1.062-.831,2.809,2.809,0,0,1-.029-.289v-5.814C711.488,317.11,711.5,316.856,711.527,316.6Z" transform="translate(-4.927 -3.677)" class="ic-color-2" /> <path id="Path_2344" data-name="Path 2344" d="M691.859,311.2a1.911,1.911,0,0,0-1.909,1.908v7.726a1.776,1.776,0,0,0,1.774,1.774h3.994a1.739,1.739,0,0,0,1.737-1.737V316.8A5.6,5.6,0,0,0,691.859,311.2Z" transform="translate(-2.758 -3.743)" class="ic-color-2" /> <path id="Path_2345" data-name="Path 2345" d="M684.576,312.064a4.217,4.217,0,0,0-2.307-.69,1.063,1.063,0,0,0-1.062,1.062v7.929a1.143,1.143,0,0,0,1.142,1.142H685.4a1.118,1.118,0,0,0,1.117-1.117v-4.764A4.243,4.243,0,0,0,684.576,312.064Z" transform="translate(-1.1 -3.776)" class="ic-color-2" /> <path id="Path_2346" data-name="Path 2346" d="M676.6,312.439a.32.32,0,0,0-.32.32v6.282a.682.682,0,0,0,.682.681h1.3a.246.246,0,0,0,.246-.246v-5.129A1.91,1.91,0,0,0,676.6,312.439Z" transform="translate(-0.164 -3.978)" class="ic-color-2" /> <path id="Path_2347" data-name="Path 2347" d="M722.545,310.852a6.555,6.555,0,0,0-6.517,6.517v5.814a1.086,1.086,0,0,0,.059.29,1.105,1.105,0,0,0,1.061.831h7.017a2.053,2.053,0,0,0,2.05-2.051v-7.729A3.675,3.675,0,0,0,722.545,310.852Z" transform="translate(-7.704 -3.677)" class="ic-color-2" /> <path id="Path_2348" data-name="Path 2348" d="M736.373,311.2a5.6,5.6,0,0,0-5.6,5.6v4.076a1.739,1.739,0,0,0,1.737,1.737h3.994a1.776,1.776,0,0,0,1.774-1.774v-7.726A1.911,1.911,0,0,0,736.373,311.2Z" transform="translate(-10.502 -3.743)" class="ic-color-2" /> <path id="Path_2349" data-name="Path 2349" d="M747.536,320.365v-7.929a1.063,1.063,0,0,0-1.062-1.062,4.274,4.274,0,0,0-4.252,4.252v4.764a1.119,1.119,0,0,0,1.117,1.117h3.054A1.143,1.143,0,0,0,747.536,320.365Z" transform="translate(-12.673 -3.776)" class="ic-color-2" /> <path id="Path_2350" data-name="Path 2350" d="M752.87,312.439a1.91,1.91,0,0,0-1.907,1.908v5.129a.246.246,0,0,0,.245.246h1.3a.682.682,0,0,0,.682-.681v-6.282A.321.321,0,0,0,752.87,312.439Z" transform="translate(-14.331 -3.978)" class="ic-color-2" /> <path id="Path_2351" data-name="Path 2351" d="M706.364,327.395a.918.918,0,0,0-.9.9v6.628a3.243,3.243,0,0,0,3.24,3.239,3.575,3.575,0,0,0,3.571-3.571v-6.833a.358.358,0,0,0-.358-.358Z" transform="translate(-5.701 -6.252)" class="ic-color-2" /> <path id="Path_2352" data-name="Path 2352" d="M696.2,326.973a1.429,1.429,0,0,0-.643.882,1.444,1.444,0,0,0-.043.332v7.246a1.549,1.549,0,0,0,1.547,1.546,4.76,4.76,0,0,0,4.755-4.755v-4.054a1.44,1.44,0,0,0-.034-.315,1.4,1.4,0,0,0-.626-.882,1.383,1.383,0,0,0-.737-.216h-3.475A1.408,1.408,0,0,0,696.2,326.973Z" transform="translate(-3.813 -6.131)" class="ic-color-2" /> <path id="Path_2353" data-name="Path 2353" d="M686.712,326.588v7.435a1.062,1.062,0,0,0,1.062,1.061,4.256,4.256,0,0,0,4.252-4.251v-3.958a.959.959,0,0,0-.032-.152,1.1,1.1,0,0,0-1.086-.965.811.811,0,0,1-.089,0l-3-.306A1.142,1.142,0,0,0,686.712,326.588Z" transform="translate(-2.144 -5.883)" class="ic-color-2" /> <path id="Path_2354" data-name="Path 2354" d="M683.108,324.154l-.767-.275a.684.684,0,0,0-.56.671v6.282a.32.32,0,0,0,.32.32,1.911,1.911,0,0,0,1.908-1.908v-4.436a.6.6,0,0,0-.6-.6A.87.87,0,0,1,683.108,324.154Z" transform="translate(-1.208 -5.585)" class="ic-color-2" /> <path id="Path_2355" data-name="Path 2355" d="M722.03,327.395h-5.556a.358.358,0,0,0-.358.358v6.833a3.575,3.575,0,0,0,3.571,3.571,3.242,3.242,0,0,0,3.239-3.239V328.29a.915.915,0,0,0-.9-.9Z" transform="translate(-7.721 -6.252)" class="ic-color-2" /> <path id="Path_2356" data-name="Path 2356" d="M727.356,326.973a1.4,1.4,0,0,0-.661,1.181v4.069a4.76,4.76,0,0,0,4.755,4.755A1.549,1.549,0,0,0,733,335.432v-7.246a1.444,1.444,0,0,0-.043-.332,1.428,1.428,0,0,0-.642-.882,1.408,1.408,0,0,0-.744-.216h-3.476A1.38,1.38,0,0,0,727.356,326.973Z" transform="translate(-9.728 -6.131)" class="ic-color-2" /> <path id="Path_2357" data-name="Path 2357" d="M737.926,325.754a.812.812,0,0,1-.089,0,1.106,1.106,0,0,0-1.087.965,1.052,1.052,0,0,0-.031.152v3.958a4.256,4.256,0,0,0,4.252,4.251,1.062,1.062,0,0,0,1.062-1.061v-7.435a1.144,1.144,0,0,0-1.1-1.141Z" transform="translate(-11.629 -5.883)" class="ic-color-2" /> <path id="Path_2358" data-name="Path 2358" d="M746.357,324.154a.865.865,0,0,1-.3.052.6.6,0,0,0-.6.6v4.436a1.91,1.91,0,0,0,1.907,1.908.32.32,0,0,0,.32-.32V324.55a.684.684,0,0,0-.56-.671Z" transform="translate(-13.287 -5.585)" class="ic-color-2" /> </g> </svg>';
const stuckIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="85" height="35.18" viewBox="0 0 85 35.18"> <g data-name="11-most-common-icons-11" transform="translate(-73.287 -180.415)"> <path id="Path_2359" data-name="Path 2359" d="M76.515,206.955c4.538.66,8.895,3.206,13.593,5.007,8.533,3.291,17.374-.1,20.39-5.316,2.439-4.229,4.42-8.49,6.86-11.388,1.385-1.63,1.076.192,1.044,1.151a2.882,2.882,0,0,1-.394,1.885,28.581,28.581,0,0,0-3.27,4.964c-4.783,8.927-12.965,15.276-24.033,11.857-6.285-1.95-9.321-5.433-15.084-7.265-2.791-.885-3.729-1.555.9-.9Z" transform="translate(0 -4.245)" class="ic-color" fill-rule="evenodd" /> <path id="Path_2360" data-name="Path 2360" d="M155.846,199.9c5,5.369,2.887,12.911-5.955,15.116-6.413,1.608-9.076,1.342-14.466,5.507-1.918,1.481-2.024.8,1.236-2,3.622-3.121,8.426-4.219,12.474-5.23,6.786-1.683,8.2-7.074,5.966-10.77a2.575,2.575,0,0,1-.182-1.576c0-.714-.2-2.259.927-1.044Z" transform="translate(-18.185 -5.695)" class="ic-color" fill-rule="evenodd" /> <path id="Path_2361" data-name="Path 2361" d="M159.393,184.451c1.9,1.566,2.29,5.029.565,6.573-3.068,2.781-5.624-.245-7.414-4.549-2.386-5.72.128-7.563,6.85-2.024Zm-75.176,0c-1.906,1.566-2.29,5.029-.575,6.573,3.079,2.781,5.625-.245,7.425-4.549,2.376-5.72-.128-7.563-6.85-2.024Zm59.048-2.951c5.231.352,6.647,3,9.5,7.318,2.461,3.739,2.482,5.646-4.314,8.32a22.455,22.455,0,0,1-3.047,1,1.541,1.541,0,0,1-1.768-.959,12.4,12.4,0,0,0-4.1-5.337,1.843,1.843,0,0,1-.725-1.321c-.4-4.016.266-9.31,4.453-9.023ZM105.64,191.2c.617-3.921,4.165-9.961,8.415-10.653,4.411-.724,6.1,1.662,6.829,6.956a1.868,1.868,0,0,1-.564,1.63c-2.632,2.557-4.645,6.5-6.381,9.715-.479.873-1.2.831-2.035.713-6.615-.927-7.339-1.428-6.264-8.362Zm-5.3-9.694c-5.231.352-6.648,3-9.5,7.318-2.461,3.739-2.482,5.646,4.325,8.32,4.655,1.832,8.426,2.653,9.556-5.944.543-4.08.053-9.992-4.378-9.694ZM137.96,191.2c-.607-3.921-4.165-9.961-8.415-10.653-5.071-.831-6.54,2.45-7.095,9.556-.746,9.619,1.182,10.6,9.247,9.46,6.615-.927,7.351-1.428,6.264-8.362Z" transform="translate(-2.77)" class="ic-color-2" fill-rule="evenodd" /> </g> </svg>';

$('.toothache-icon').html(toothacheIcon);
$('.chipped-icon').html(chippedIcon);
$('.cracked-icon').html(crackedIcon);
$('.sensitive-icon').html(sensitiveIcon);
$('.knocked-icon').html(knockedIcon);
$('.lost-icon').html(lostIcon);
$('.broken-icon').html(brokenIcon);
$('.loose-icon').html(looseIcon);
$('.injury-icon').html(injuryIcon);
$('.pain-icon').html(painIcon);
$('.stuck-icon').html(stuckIcon);
