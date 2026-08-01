$(function () {
    $('header nav').meanmenu({
        meanMenuContainer: 'header .place-nav',
        meanMenuOpen: "<i class='icon-menu'></i>",
        meanMenuClose: "<i class='icon-plus'></i>",
        meanScreenWidth: 1025,
        meanDisplay: "block"
    });

    // this will get the full URL at the address bar
    var url = window.location.href; 
    // passes on every "a" tag 
    $("#main-nav a").each(function() {
            // checks if its the same on the address bar
        if(url == (this.href)) { 
            $(this).closest("li").addClass("active").attr("aria-current", "Page");
        }
    });

    $("nav a[href^='https']").attr({target:"_blank", rel:"noopener noreferrer" });
    $("a[name]").parent().addClass('has_target');
    $("#page h1, h2#append").appendTo("#page-title");
    $("#page .page-divider").parent("#page").addClass('has_divider');
    $(".internal .more-to-explore").appendTo(".internal");

    $("#main-link").click(function() { $('main').focus(); });
    $("#nav-link").click(function() { $('#main-nav').focus(); });
    $("#bn-play").click(function() { $('#bn-vid').focus(); });
    $("#popup").click(function() { $('.modal-content').focus(); });
    
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
        if ($(window).width() <= 1025) {
            $("footer").css('padding-bottom', $("#fixed-tabs").outerHeight());
        }
    }).trigger('resize');

    $(".read").on("click", function () {
        $(this).toggleClass("active")
        let text = $(this).find(".text")
    
    
        if (text.text() == "Read More") { 
            text.text("Read Less"); 
        } else { 
            text.text("Read More"); 
        }; 
    })

    /////////////// fixed header with animated in on desktop and attach on mobile

    if (theWindow.width() > 1025) {
        if (theWindow.scrollTop() >= headerBottom) {
            body.addClass("fix-nav");
            header.addClass("animated slideInDown");
        } else if (theWindow.scrollTop() <= headerBottom) {
            body.removeClass("fix-nav");
            header.removeClass("animated slideInDown");
        }
    }

    
    theWindow.on("scroll", function () {
        if (theWindow.width() > 1025) {
            if (theWindow.scrollTop() >= headerBottom) {
                body.addClass("fix-nav");
                header.addClass("animated slideInDown");
            } else if (theWindow.scrollTop() <= headerBottom) {
                body.removeClass("fix-nav");
                header.removeClass("animated slideInDown");
            }
        }

    });

// Hide Hours for Certain Office
    // $('.fm-office').on('change', function (e) {
    //     var optionSelected = $("option:selected", this);
    //     var valueSelected = this.value;
        
    // if(valueSelected == "Office"){
    // $(".fm-hide").hide();
    // } else {
    // $(".fm-hide").show();
    // }
    // });

      // Insurance Form
        $('.searchable-select').select2();

      
      
    $('.searchable-select').on('change', function(){

    var optionSelected = $("option:selected", this);

      $('#appt-form input[name=insurance]').val(optionSelected.text()).addClass('input--filled');

      $('#appt-form input[name=insurance]').parent().addClass('input--filled');

    })





          var theWindow = $(window);
          
        if (theWindow.width() > 749) {
              $("#appt-form .day").insertAfter(".flex-row-input")
          }
     
              $("#interests").change(function () {
                  var intList = $('#interests');
                      if (intList.val() === 'Other') {
                          $(this).parent().parent().addClass("oth")
                  } else {
                      $("#int-list").removeClass("oth")
                  }
              });
     
          $("#submit").click(function () {
          
              // $("#submit").click(function () {
              //     var list = $('#insureList');
              //         if (list.val() === 'none') {
              //             $("#in").hide();
              //             $("#out").hide();
              //             $("#no-insure").show().addClass('open-in');
              //     }
              // });

              
            var list = $('#insureList');
              if (list.val() === 'out') {
                  $("#in").hide();
                   $("#out").show().addClass('open-in');
              }

          });

          $("#submit").click(function () {
              var list = $('#insureList');
                  if (list.val() === 'in') {
                      $("#out").hide();
                      $("#in").show().addClass('open-in');
              }
          });

          $(".close-ins").click(function () {
              $('#insureList').val("");
              $(this).parent().removeClass('open-in').hide()
              $("#in").hide()
              $("#out").hide()
              $(".insure-modal").hide()
              // $('#appt-form').find("input").val("");
              // $('#appt-form').find("textarea").val("");
              // $('#appt-form').find("select").val("");
              $("#appt-form").hide()
           });


           $(".btn.now").click(function () {
              $("#appt-form").show()
          });
// End Insurance FOrm
      

    var url = window.location.href; 
    // passes on every "a" tag 
    $("header nav a").each(function() {
            // checks if its the same on the address bar
        if(url == (this.href)) { 
            $(this).closest("li").addClass("active").attr("aria-current", "Page");
        }
    });
    $('nav ul li').each(function() {
        if ($(this).find('ul').length) {
            ($(this).addClass('has-submenu').attr('aria-haspopup', 'true'))
        }
    });

    if (theWindow.width() > 1025) {
       $('nav > ul > .has-submenu > a').append("<button aria-label='Toggle submenu'><i class='icon-angle-down'></i></button>")
       $('nav ul ul > .has-submenu > a').append("<button aria-label='Toggle submenu'><i class='icon-angle-right'></i></button>")
    }


    if (theWindow.width() <= 1025) {
        var didScroll,lastScrollTop=0,delta=5,navbarHeight=$("header").outerHeight();function hasScrolled(){var l=$(this).scrollTop();Math.abs(lastScrollTop-l)<=delta||(l>lastScrollTop&&l>navbarHeight?$("header").removeClass("nav-down").addClass("nav-up"):l+$(window).height()<$(document).height()&&$("header").removeClass("nav-up").addClass("nav-down"),lastScrollTop=l)}$(window).scroll(function(l){didScroll=!0}),setInterval(function(){didScroll&&(hasScrolled(),didScroll=!1)},250);
    }

    if ($(window).width() <= 1025) {
        $("footer .social").clone().prependTo(".mean-container .mean-nav");
        $("footer .hours").clone().appendTo(".mean-container .mean-nav");
    }


     // MODAL
// adds close button to modals
$(".modal-content").each(function () {
    $('<button class="modal-close"/>').appendTo(this);
  });
  
  //Open and Close Modal
  $('a[class*=modal]').on('click', function (e) {
    e.preventDefault()
    const href = $(this).attr('href')
    const modalElement = document.querySelector(`dialog${href}`)
    this.open ? this.parentElement.close() : (modalElement).showModal()
  
    // Clicking popup moves keyboard focus into modal 
    let trimmed = href.substring(1);
    document.getElementById(trimmed).focus();
  });
  
  $('.modal-close').on('click', function (e) {
    this.parentElement.open ? this.parentElement.close() : (modalElement).showModal();
  });

     
     // In Firefox and Safari plays modal popup videos automatically
     $("#openVid").on("click", function() {
        $("#bio-modal .youtube:not('.active')").trigger("click");
      });
  // Closing popup modal turns off video
    $(".modal-close").on("click", function(){
        for (var i = 0; i < $('.modal-content .youtube iframe').length; i++) {
          var video = $('.modal-content .youtube iframe').attr("src");
          var video = video.replace("autoplay=1", "autoplay=0") ;
          $('.modal-content youtube iframe').attr("src","");
          $('.modal-content .youtube iframe').attr("src",video);
        }
    });


    var menuItemsBut = document.querySelectorAll('li.has-submenu');
    Array.prototype.forEach.call(menuItemsBut, function(el, i){
        el.querySelector('button').addEventListener("click",  function(event){
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

});   // end of top function



// $.fn.wrapInTag = function(opts) {
//     var tag = opts.tag || 'strong',
//         words = opts.words || [],
//         regex = RegExp(words.join('|'), 'gi'),
//         replacement = '<' + tag + '>$&</' + tag + '>';
//     var icon = $(this).find("i, img").remove();
//     var newText = $(this).text().replace(regex, replacement);
//     if ($(this).text() === newText) {
//         $(this).html($(this).text().replace(/^(\w+)/, '<strong>$1</strong>'));
//         if (icon.length > 0) {
//             icon.prependTo($(this));
//         }
//     } else {
//         $(this).html(newText);
//         if (icon.length > 0) {
//             icon.prependTo($(this));
//         }
//     }
// };


$(function () {
    var theWindow = $(window);

////////////////////////////// Wrap words in in a tag
    // $(".why h2").each(function() {
    //     $(this).wrapInTag({
    //         tag: 'span',
    //         words: ['Why Choose']
    //     });
    // });


 $( ".why ul li" ).wrapInner( "<span></span>");

////////////////////////////// Randomized Banner Background
     var selectBG = Math.floor(Math.random() * 10) + 1;
     if (!$("body").hasClass("page_index")) {
         $('#interior-banner').css({
             'background-image': 'url(assets/images/interior-banner-' + selectBG + '.jpg)',
             'background-size': 'cover',
             'background-repeat': 'no-repeat',
             'background-position': 'center center'
         })
     }

      $("#static-banner").each(function() {
         var staticBn = $(this).find("img").attr("src");
         $('#interior-banner').css({
             'background-image': 'url(' + staticBn + ')',
             'background-size': 'cover',
             'background-repeat': 'no-repeat',
             'background-position': 'center center'
         })
     })


      ////////////////////////////// FAQ / Accordion
      $(".accordion h3, .accordion h2").each(function () {
        $(this).wrap('<button></button>').parent().addClass('toggle');
    });
    $(".toggle").each(function () {
        $(this).nextUntil('.toggle').add().wrapAll('<div>');
    });
    $(".toggle").each(function () {
      $(this).nextUntil('.toggle').addBack().wrapAll('<article>');
    });
    $(".toggle").on("click", function () {
        if ($(this).hasClass("active")) {
            $(this).parent().removeClass("active");
            $(this).removeClass("active").next().slideUp();
        } else {
            $(".toggle").parent().removeClass("active");

            $(".toggle").removeClass("active").next().slideUp();
            $(this).parent().addClass("active");
            $(this).addClass("active").next().slideDown();
        }
        for (var i = 0; i < $('.accordion iframe').length; i++) {
            var video = $('.accordion iframe').attr("src");
            var video = video.replace("autoplay=1", "autoplay=0") ;
            $('.accordion iframe').attr("src","");
            $('.accordion iframe').attr("src",video);
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
                    .wrapAll('<div class="divider-block">');
        });

         $(".divider-block").each(function (index) {
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
           $(".page-divider .divider-block a[name]:first-of-type").each(function () {
            var getAnchor = $(this).parent(".has_target"),
                anchorTarget = $(this).parentsUntil(".page-divider").next().find(".dividerLead").parent();
            getAnchor.remove();
            $(this).prependTo(anchorTarget);
        });

    }

    $(".divider-block [class^='btn']").parent("p").addClass('has_btn');

/////////  mini-blocks for h3 inside divider blocks
    $(".page-divider h3").not('.skip-this h3').each(function(){
        $(this).nextUntil('h3, .dividerLead').addBack().wrapAll('<div>')
        .parent().addClass("mini-block")
    });
    $(".mini-block").each(function (index) {
        $(this)
            .find('h3')
            .next(".elem-sm")
            .addClass(index % 2 ? 'elem-left' : 'elem-right')
        if ($(window).width() >= mobileWidth) {
            $(this).children(".elem-sm").insertBefore($(this).children("h3"));
        }
    })

    ///////////// wraps text & .btn in article after .divider-block .elem
    $(".divider-block .elem + *, .divider-block .wrap, .mini-block h3").each(function () { //auto wrap
        $(this).nextUntil('.divider-block, .mini-block').addBack().wrapAll('<article>');
    });

    /// for flexing inside .divider-blocks
    $(".divider-block .elem").each(function () { //auto wrap
        $(this).nextUntil('.divider-block, .mini-block').addBack().wrapAll('<div>').parent().addClass('contain');
    });

        ////////  If no image insided block to change styles
        $('.divider-block').each(function() {
            if (!$(this).find('.elem').length) {
                ($(this).addClass('no_img'))
            }
        });
        $(".divider-block.no_img .dividerLead").each(function () { //auto wrap
            $(this).nextUntil('.divider-block').addBack().wrapAll('<article>');
        });

         $(".divider-block, .divider-body").each(function (index)  {
             $(this).find('.section-toggle, .divider-bot').appendTo($(this));
        });

         
          $("button.togg").each(function ()  {
            this.setAttribute('aria-expanded', "false");
            });
         
         $("button.togg").on("click", function() {
           if ($(this).hasClass("active")) {
             this.setAttribute('aria-expanded', "false");
              $(this).removeClass("active").closest('.divider-block, .divider-body').find(".section-toggle").slideUp();
           } else {
              this.setAttribute('aria-expanded', "true");

             $(this).addClass("active").closest('.divider-block, .divider-body').find(".section-toggle").slideDown();

           }
         });

    /////////// If needed to change explore section if page divider ends with odds
    //   $(".page-divider .divider-block:nth-of-type(odd):last-child").parent(".page-divider").addClass('has_oddlast');
    //     if ($(".page-divider").hasClass("has_oddlast")) {
    //           $('.more-to-explore').addClass("bkgrd");
    //       }


    //////// Takes an image and makes it background image to fill flexed container
    if (theWindow.width() > 1001) {
        $("#main-img").each(function() {
            var mainBkg = $(this).find("img").attr("src");
                    $(this).css({
                        'background-image': 'url(' + mainBkg + ')',
                        'background-size': 'cover',
                        'background-repeat': 'no-repeat',
                        'background-position': 'top 15% center',
                    })
            });
        }
    
  //////// Takes data-image source and makes it background image to fill flexed container
     ////// ie:  <div class="bkg-img" data-img="assets/images/callout-1.jpg">
       /*
        $(".bkg-img").each(function() {
            var bkgImg = $(this).data("img");
            $(this).css({
                'background-image': 'url(' + bkgImg + ')',
                'background-size': 'cover',
                'background-repeat': 'no-repeat',
                'background-position': 'center center'
            })
        })
      */

    ///// Takes main banner image on page and flexes with page title
    $("#main-img").appendTo("#interior-banner .contain")
    $("#main-img").appendTo("#interior-banner")
    $('#interior-banner').each(function() {
        if ($(this).find('#main-img').length) {
              $("#interior-banner .contain").next('#main-img').addBack().wrapAll('<div>').parent().addClass('flex-title');
        }
    });



    // page title + intro - interior banner
    ////////////  Add flex to .top img/video + text before page-dividers
    $("#page > p:first-of-type").each(function() {
        $(this).nextUntil("div, h1, h2, h3, form").addBack().wrapAll("<article id='intro'>")
    });

   $("#intro").appendTo("#interior-banner .contain")

    //////////  Adding interior banner videos
    // $('#page-title').each(function() {
    //     if ($(this).find('.play').length) {
    //         $(".page-banner").attr("data-player", "youtube")
    //     }
    // });



//////// Banner and testimonial video with different top offsets

    var theWindow = $(window);
    $("#banner[data-player]").tntvideos({
        playButton: '.play',
        closeButton: '.close',
        bodyPlaying: null,
        mobileWidth: 1024,
        animate: true,
        // mobileAppendPlay: '#banner article'
        closeButtonString: '<button class="close" aria-label="close video"><i class="icon-plus"></i> Close Video</button>'
    });

    if (theWindow.width() < 1025) {
        $('#banner .play').appendTo('#banner [data-embed]')
    }

    $("#testimonials[data-player]").tntvideos({
        playButton: '.play',
        closeButton: '.close',
        animate: true,
        mobileWidth: 1000
    });

     //Basic youtube embed with close button/for internal pages
     $(".internal [data-player]").tntvideos({
         closeButton: '.close',
         playButton: '.yt-play',
         animate: false,
         mobileWidth: 1000,
         offset:0,
         closeButtonString: '<span><i class="icon-plus"></i></span>'
     });

   $('.video-grid > div iframe').wrap('<div class="videoWrapper"></div>')


$('.slick-reviews').slick({
  dots: true,
  arrows: true,
  appendDots: "#reviews .slick-controls",
  appendArrows: "#reviews .slick-controls",
  draggable: false,
  autoplay: true,
  cssEase: 'linear',
  autoplaySpeed: 10000,
  infinite: true,
  speed: 300,
  prevArrow:'<button class="arrow" id="prev" aria-label="Previous Slide"><i class="icon-angle-left"></i></button>',
  nextArrow:'<button class="arrow" id="next" aria-label="Next Slide"><i class="icon-angle-right"></i></button>',
  customPaging: function () {
    return '<button><span></span></button>';
  },

  responsive: [
    {
      breakpoint: 1025,
      settings: {
        slidesToShow: 1,
        variableWidth: true,
        centerMode: false,
        draggable: true
      }
    },
    {
      breakpoint: 9999,
      settings: "unslick"
    }
  ]
});


    var $status = $('.gallery .pagingInfo');
    var $gallery = $('.gallery .slick-gallery');
    $gallery.on('init reInit afterChange', function (event, slick, currentSlide, nextSlide) {
        //currentSlide is undefined on init -- set it to 0 in this case (currentSlide is 0 based)
        var i = (currentSlide ? currentSlide : 0) + 1;
        $status.html(`<span> ${i} </span>/<span> ${slick.slideCount} </span> `)
    });


$('.slick-gallery').each(function () {
  const $gallery = $(this);
  const $controls = $gallery.closest('.gallery').find('.slick-controls');

  $gallery.slick({
    dots: false,
    arrows: true,
    autoplay: true,
    autoplaySpeed: 3000,
    infinite: true,
    centerMode: true,
    centerPadding: '0px',
    slidesToShow: 1,
    variableWidth: true,
    adaptiveHeight: true,

    appendDots: $controls,
    appendArrows: $controls,

    prevArrow:
      '<button type="button" class="arrow prev" aria-label="Previous Slide">' +
      '<i class="icon-angle-left"></i>' +
      '</button>',

    nextArrow:
      '<button type="button" class="arrow next" aria-label="Next Slide">' +
      '<i class="icon-angle-right"></i>' +
      '</button>',

    customPaging: function () {
      return '<button><span></span></button>';
    },
    responsive: [
      {
        breakpoint: 1025,
        settings: {
          fade: true,
          slidesToShow: 1,
          slidesToScroll: 1,
          centerMode: false,
          variableWidth: false,
          infinite: false,
          autoplay: true
        }
      }
    ]
  });
});




});   /*end of videos & slider function */



  // leanModal v1.1 by Ray Stone - http://finelysliced.com.au
  // Dual licensed under the MIT and GPL



  !function(e){e.fn.extend({leanModal:function(a){var o=e("<div id='lean_overlay'></div>");return e("body").append(o),a=e.extend({top:"0",overlay:"rgba(0,0,0,0)",closeButton:".modal-close"},a),this.each(function(){var o=a;e(this).click(function(a){e("body").addClass("lean-open").css({overflow:"hidden"});var n=e(this).attr("href");e(o.closeButton).click(function(){!function(a){e("body").removeClass("lean-open");e("#lean_overlay").fadeOut(200),e("body").css({overflow:"visible"}),e(a).css({display:"none"});var o=e("#lean_overlay iframe"),n=o.attr("src");o.attr("src",""),o.attr("src",n)}(n)});e(n).outerHeight(),e(n).outerWidth();e("#lean_overlay").css({display:"flex",background:"rgba(0,0,0,.7)"}),e("#lean_overlay").fadeTo(200,o.overlay),e(n).appendTo("#lean_overlay").css({display:"block","z-index":1001,opacity:0}),e(n).fadeTo(200,1),a.preventDefault()})})}})
           }(jQuery);
                 

  $("a[rel*=leanModal]").leanModal({top:10});

document.addEventListener('keydown', function(event){
  if(event.key === "Escape"){
        $("#lean_overlay").trigger("click");
  }
});





/* Other slick slider options - Delete if not needed */


    // $(".slick-banner").slick({      
    //     dots:true,   
    //     arrows:false,          
    //     appendDots:".banner-controls",
    //     customPaging:function(slider,index) {         
    //      return '<span></span>';
    //     },
    //     fade:true,
    //     draggable:false,
    //     autoplay:true,
    //     autoplaySpeed:8000,
    //     speed:800,        
    //     responsive: 
    //     [{
    //     breakpoint: 1023,
    //     settings: {                         
    //     } 
    //     }]

    // }); 

    // $("#banner-nav").slick({
    //     arrows:false,   
    //     dots:false,     
    //     draggable:false,
    //     infinite:false,
    //     autoplay:false,
    //     slidesToShow:4,
    //     focusOnSelect:true,
    //     asNavFor: ".slick-banner"
    // }); 


    // $(".slick-specials").slick({      
    //     dots:true,     
    //     arrows:true,   
    //     appendArrows:".specials-controls",
    //     appendDots:".specials-controls",
        // prevArrow:'<a href="#" id="prev"><i class="icon-angle-left"></i></a>',
        // nextArrow:'<a href="#" id="next"><i class="icon-angle-right"></i></a>',      
    //     slidesToShow:2,
    //     focusOnSelect:true,
    //     responsive: 
    //     [{
    //         breakpoint: 900,
    //         settings: {
    //             slidesToShow:1
    //         } 
    //     }],
    //     customPaging:function(slider,index) {
    //         return '<span></span>';
    //     }
    // }); 

    // if(theWindow.width() > 1023) {
    //     $(".slick-about").slick({      
    //         dots:true,     
    //         arrows:true,           
    //         appendArrows:".about-controls",
        // prevArrow:'<a href="#" id="prev"><i class="icon-angle-left"></i></a>',
        // nextArrow:'<a href="#" id="next"><i class="icon-angle-right"></i></a>',     
    //         appendDots:".about-controls",
    //         customPaging:function(slider,index) {
    //         var totalCount = "", totalSlides = ""; //to add 0
    //         if (slider.slideCount < 10) { totalCount = ""; }
    //         if (index < 9) { totalSlides ="";  }   
    //         return '<span><b>' + totalSlides + (index + 1) + '</b>/' + totalCount + slider.slideCount +'</span>';
    //         }
    //     });         
    // }

    //  if (theWindow.width() > 1023) {
    //     $(".slick-callouts").slick({      
    //         dots:false,     
    //         arrows:false,           
    //         fade:true,
    //         draggable:false,
    //         focusOnSelect: true,
    //         autoplay:false,
    //         asNavFor: '#switch-nav'
    //     }); 
    //     $("#callouts-nav").slick({
    //         arrows:false,   
    //         dots:false,     
    //         draggable:false,
    //         infinite:false,
    //         autoplay:false,
    //         slidesToShow:6,
    //         focusOnSelect:true,
    //         asNavFor: ".slick-switch"
    //     });
    // }

    // if (theWindow.width() > 1023) {
    //     $(".slick-switch").slick({      
    //         dots:false,     
    //         arrows:false,           
    //         fade:true,
    //         draggable:false,
    //         focusOnSelect: true,
    //         autoplay:false,
    //         asNavFor: '#switch-nav'
    //     }); 
    //     $("#switch-nav").slick({
    //         arrows:false,   
    //         dots:false,     
    //         draggable:false,
    //         infinite:false,
    //         autoplay:false,
    //         slidesToShow:3,
    //         focusOnSelect:true,
    //         asNavFor: ".slick-switch"
    //     });
    // }

    // if(theWindow.width() > 1023) {

    // $(".services-nav").slick({
    //     arrows:false,   
    //     dots:false,     
    //     draggable:false,
    //     infinite:false,
    //     vertical:true,
    //     slidesToShow:5,
    //     focusOnSelect:true,
    //     asNavFor: ".slick-services"
    // });
    // }

    // if(theWindow.width() > 1023) {
    //     $(".slick-callouts").slick({
    //         dots:true,
    //         arrows:true,
    //         centerMode:true,
    //         slidesToShow:3,
    //         appendDots:".callouts-controls",
    //         appendArrows:".callouts-controls",
        // prevArrow:'<a href="#" id="prev"><i class="icon-angle-left"></i></a>',
        // nextArrow:'<a href="#" id="next"><i class="icon-angle-right"></i></a>',                      
    //         customPaging:function(slider,index) {         
    //             return '<span></span>';
    //         }
    //     }); 
    // }    



$(document).ready(function () {
    if (window.location.hash) {
        var tag = $('a[name=' + window.location.hash.substring(1) + ']')
        $(tag)[0].scrollIntoView();
    }
});


// Disable blog menu nav from opening in a new tab
$(document).ready(function()
{
    var blogElementTwo = $('nav a').filter(function()
    {
        return $(this).text().includes('Blog') || $(this).attr('href').includes('Blog');
    });

    if (blogElementTwo.length)
    {
        blogElementTwo.removeAttr('target');
    }
});
