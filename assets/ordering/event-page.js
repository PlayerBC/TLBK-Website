const services = {
  party: {
    pageName: 'Party Carts', pageUrl: 'partycarts.html', adminTitle: 'Party packages',
    packageName: 'party package', photoName: 'Party cart', customName: 'cart',
    packagesApi: 'party_packages_api', itemsApi: 'party_cart_items_api', photosApi: 'party_cart_photos_api',
    packagesClient: 'partyPackagesApi', itemsClient: 'partyCartItemsApi', photosClient: 'partyCartPhotosApi',
    allowEmptyInclusions: false,
  },
  dessert: {
    pageName: 'Dessert Bar', pageUrl: 'dessertbar.html', adminTitle: 'Dessert bar',
    packageName: 'dessert bar package', photoName: 'Dessert bar', customName: 'dessert bar',
    packagesApi: 'dessert_bar_packages_api', itemsApi: 'dessert_bar_items_api', photosApi: 'dessert_bar_photos_api',
    packagesClient: 'dessertBarPackagesApi', itemsClient: 'dessertBarItemsApi', photosClient: 'dessertBarPhotosApi',
    allowEmptyInclusions: true,
  },
};

// Only these two known services can select endpoints or dashboard labels.
export function eventPage(name = 'party') { return services[name] || services.party; }
